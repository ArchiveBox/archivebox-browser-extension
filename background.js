// background.js

import { addToArchiveBox } from "./utils.js";

// Queue for managing entry saving
const entrySaveQueue = [];
let processingQueue = false;

// Process the save queue
function processEntrySaveQueue() {
  if (entrySaveQueue.length === 0) {
    processingQueue = false;
    return;
  }
  
  processingQueue = true;
  const entry = entrySaveQueue.shift();
  
  // Process entry
  chrome.storage.local.get(['entries', 'enableScrollCapture'], (result) => {
    // Only save entries if automatic capture is enabled
    if (!result.enableScrollCapture) {
      setTimeout(processEntrySaveQueue, 200);
      return;
    }
    
    const entries = result.entries || [];
    
    // Normalize URLs for more accurate comparison
    const normalizeUrl = (url) => {
      try {
        const normalized = new URL(url);
        // Remove trailing slashes, query parameters, and fragment
        return normalized.origin + normalized.pathname.replace(/\/$/, '');
      } catch (e) {
        return url;
      }
    };
    
    const normalizedEntryUrl = normalizeUrl(entry.url);
    
    // Check if this URL already exists in our entries (use normalized URLs)
    const existingEntry = entries.find(e => normalizeUrl(e.url) === normalizedEntryUrl);
    if (existingEntry) {
      setTimeout(processEntrySaveQueue, 200);
      return;
    }
    
    // Add custom tags if configured
    chrome.storage.local.get(['scrollCaptureTags'], (tagResult) => {
      const customTags = tagResult.scrollCaptureTags ? 
        tagResult.scrollCaptureTags.split(',').map(tag => tag.trim()) : [];
      
      // Extract site tags
      const siteTags = getSiteTags(entry.url);
      
      // Create the full entry object
      const fullEntry = {
        id: crypto.randomUUID(),
        url: entry.url,
        timestamp: entry.timestamp || new Date().toISOString(),
        tags: ['auto-captured', ...siteTags, ...customTags, ...(entry.tags || [])],
        title: entry.title || 'Captured content',
        notes: `Auto-captured content: ${entry.url}`
      };
      
      entries.push(fullEntry);
      
      chrome.storage.local.set({ entries }, () => {
        // Process next item after a delay - increased for better throttling
        setTimeout(processEntrySaveQueue, 500);
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle opening options page
  if (message.action === 'openOptionsPage') {
    const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    chrome.tabs.create({ url: options_url });
  }
  
  // Handle archivebox_add
  if (message.type === 'archivebox_add') {
    addToArchiveBox(message.body, sendResponse, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle content capture
  if (message.type === 'capture') {
    saveEntry(message.entry);
    sendResponse({ success: true });
  }
  
  return true; // Indicate async response
});

chrome.action.onClicked.addListener(async (tab) => {
  // Don't try to execute script on chrome:// URLs
  if (tab.url.startsWith('chrome://')) {
    return;
  }
  
  const entry = {
    id: crypto.randomUUID(),
    url: tab.url,
    timestamp: new Date().toISOString(),
    tags: [],
    title: tab.title,
    favicon: tab.favIconUrl
  };
  
  // Save the entry first
  const { entries = [] } = await chrome.storage.local.get('entries');
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  
  // Inject scripts
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  }).catch(err => {
    console.error('Error injecting script:', err);
  });
});

chrome.contextMenus.onClicked.addListener(onClickContextMenuSave);

// A generic onclick callback function.
async function onClickContextMenuSave(item, tab) {
  // Don't try to execute script on chrome:// URLs
  if (tab.url.startsWith('chrome://')) {
    return;
  }
  
  const entry = {
    id: crypto.randomUUID(),
    url: tab.url,
    timestamp: new Date().toISOString(),
    tags: [],
    title: tab.title,
    favicon: tab.favIconUrl
  };
  
  // Save the entry first
  const { entries = [] } = await chrome.storage.local.get('entries');
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  
  // Inject scripts
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  }).catch(err => {
    console.error('Error injecting script:', err);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});

// Replace the saveEntry function with this throttled version
function saveEntry(entry) {
  // Don't save if no URL
  if (!entry || !entry.url) return;
  
  // Add to queue
  entrySaveQueue.push(entry);
  
  // Start processing if not already running
  if (!processingQueue) {
    processEntrySaveQueue();
  }
}

// Extract site name for tagging
function getSiteTags(url) {
  try {
    const hostname = new URL(url).hostname;
    const domain = hostname
      .replace('www.', '')
      .replace('.com', '')
      .replace('.org', '')
      .replace('.net', '');
    return [domain];
  } catch (e) {
    return [];
  }
}

// Setup content capture for Reddit
function setupContentCapture() {
  // Setup page load detection
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only run once the page is fully loaded
    if (changeInfo.status !== 'complete') return;
    
    // Only run on Reddit
    if (!tab.url.includes('reddit.com')) return;
    
    // Execute the content script immediately after page load
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      function: setupPageCapture
    }).catch(err => {
      console.error('Error setting up page capture:', err);
    });
  });
}

// Call this function when the extension starts
chrome.runtime.onStartup.addListener(setupContentCapture);
chrome.runtime.onInstalled.addListener(setupContentCapture);

// This function sets up the content capture on Reddit pages
function setupPageCapture() {
  console.log('[ArchiveBox] Setting up page capture');
  
  // Skip if already set up
  if (window.archiveBoxSetupComplete) return;
  window.archiveBoxSetupComplete = true;
  
  // Create tracking set if it doesn't exist
  if (!window.archiveBoxProcessedElements) {
    window.archiveBoxProcessedElements = new Set();
  }
  
  // Create a queue for captured entries to throttle submissions
  if (!window.archiveBoxCaptureQueue) {
    window.archiveBoxCaptureQueue = [];
  }
  
  // Setup throttled submission process
  if (!window.archiveBoxProcessingQueue) {
    window.archiveBoxProcessingQueue = false;
    
    function processQueue() {
      if (window.archiveBoxCaptureQueue.length === 0) {
        window.archiveBoxProcessingQueue = false;
        return;
      }
      
      window.archiveBoxProcessingQueue = true;
      const entry = window.archiveBoxCaptureQueue.shift();
      
      chrome.runtime.sendMessage({
        type: 'capture',
        entry: entry
      }, () => {
        // Add timeout for throttling
        setTimeout(processQueue, 500);
      });
    }
    
    // Function to add to queue and start processing if needed
    window.queueCaptureEntry = (entry) => {
      // Avoid duplicate entries in the queue by URL
      if (!window.archiveBoxCaptureQueue.some(item => item.url === entry.url)) {
        window.archiveBoxCaptureQueue.push(entry);
        
        // Start queue processing if not already running
        if (!window.archiveBoxProcessingQueue) {
          processQueue();
        }
      }
    };
  }
  
  // Create status indicator if it doesn't exist
  if (!document.getElementById('archiveBoxStatusIndicator')) {
    const indicator = document.createElement('div');
    indicator.id = 'archiveBoxStatusIndicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 12px;
      z-index: 9999;
      transition: opacity 0.5s;
      opacity: 0;
    `;
    document.body.appendChild(indicator);
  }
  
  // Function to show status
  window.showArchiveBoxStatus = (message) => {
    const indicator = document.getElementById('archiveBoxStatusIndicator');
    if (indicator) {
      indicator.textContent = `ArchiveBox: ${message}`;
      indicator.style.opacity = '1';
      setTimeout(() => {
        indicator.style.opacity = '0';
      }, 2000);
    }
  };
  
  // Improved scroll event listener with throttling
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    // Cancel any pending scan
    if (scrollTimeout) clearTimeout(scrollTimeout);
    
    // Schedule a new scan after user stops scrolling for 300ms
    scrollTimeout = setTimeout(() => {
      scanVisiblePosts();
    }, 300);
  });
  
  // Add mutation observer to detect new Reddit posts dynamically added to the page
  const observeNewContent = () => {
    const targetNode = document.body;
    
    // Observer configuration
    const config = { 
      childList: true, 
      subtree: true,
      attributes: false 
    };
    
    // Callback to be executed when mutations are observed
    const callback = function(mutationsList, observer) {
      let hasNewPosts = false;
      
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          // Check if any added nodes contain potential Reddit posts
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check for new content: either the node is a post or contains posts
              if (
                (node.tagName === 'SHREDDIT-POST') || 
                (node.querySelector && (
                  node.querySelector('shreddit-post') || 
                  node.querySelector('.thing.link')
                ))
              ) {
                hasNewPosts = true;
                break;
              }
            }
          }
        }
        
        if (hasNewPosts) break;
      }
      
      // Only scan if we detected new posts being added
      if (hasNewPosts) {
        // Use a small delay to ensure the DOM is fully updated
        setTimeout(() => {
          scanVisiblePosts();
        }, 100);
      }
    };
    
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);
    
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);
  };
  
  // Start the mutation observer
  observeNewContent();
  
  // Do initial scan
  console.log('[ArchiveBox] Performing initial scan');
  // Small delay for initial scan to ensure the page is fully loaded
  setTimeout(() => {
    scanVisiblePosts();
  }, 300);
  
  function scanVisiblePosts() {
    // Process shreddit-post elements (new Reddit)
    scanElements('shreddit-post', (post) => {
      const permalink = post.getAttribute('permalink');
      const postTitle = post.getAttribute('post-title');
      const subredditName = post.getAttribute('subreddit-prefixed-name');
      
      if (permalink) {
        const fullUrl = permalink.startsWith('http') ? 
          permalink : `https://www.reddit.com${permalink}`;
        
        // Extract subreddit from prefixed name (r/subreddit)
        let subreddit = '';
        if (subredditName && subredditName.startsWith('r/')) {
          subreddit = subredditName.substring(2);
        }
        
        return {
          url: fullUrl,
          title: postTitle || document.title,
          tags: ['reddit', subreddit]
        };
      }
      return null;
    });
    
    // Process .thing.link elements (old Reddit)
    scanElements('.thing.link', (post) => {
      const permalink = post.getAttribute('data-permalink');
      if (permalink) {
        const fullUrl = `https://www.reddit.com${permalink}`;
        const title = post.querySelector('.title a')?.textContent || '';
        const subreddit = post.getAttribute('data-subreddit') || '';
        
        return {
          url: fullUrl,
          title: title,
          tags: ['reddit', subreddit]
        };
      }
      return null;
    });
  }
  
  function scanElements(selector, extractFn) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`[ArchiveBox] Found ${elements.length} elements matching '${selector}'`);
    }
    
    Array.from(elements).forEach(element => {
      // Skip already processed elements
      if (window.archiveBoxProcessedElements.has(element)) return;
      
      // Check if the element is visible in the viewport
      const rect = element.getBoundingClientRect();
      const isVisible = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      );
      
      // Only process visible elements
      if (!isVisible) return;
      
      // Extract entry data
      const entry = extractFn(element);
      if (!entry) return;
      
      // Mark as processed
      window.archiveBoxProcessedElements.add(element);
      
      // Add to throttled queue instead of sending immediately
      window.queueCaptureEntry(entry);
      
      // Show status
      window.showArchiveBoxStatus(`Captured: ${entry.title.substring(0, 30)}...`);
      
      console.log(`[ArchiveBox] Queued for capture: ${entry.url}`);
    });
  }
}
