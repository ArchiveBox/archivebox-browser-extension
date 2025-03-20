// background.js

import { addToArchiveBox } from "./utils.js";

// Debug configuration
const DEBUG_MODE = false; // Easy toggle for debugging

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[ArchiveBox Debug]', ...args);
  }
}

// Queue for managing entry saving
const entrySaveQueue = [];
let processingQueue = false;

// Process the save queue
function processEntrySaveQueue() {
  if (entrySaveQueue.length === 0) {
    processingQueue = false;
    debugLog('Queue empty, stopping processor');
    return;
  }
  
  processingQueue = true;
  const entry = entrySaveQueue.shift();
  debugLog('Processing entry from queue:', entry.url);
  
  // Process entry
  chrome.storage.local.get(['entries', 'enableScrollCapture'], (result) => {
    // Only save entries if automatic capture is enabled
    if (!result.enableScrollCapture) {
      debugLog('Automatic content capture disabled, not saving entry');
      setTimeout(processEntrySaveQueue, 200);
      return;
    }
    
    const entries = result.entries || [];
    debugLog('Current entries count:', entries.length);
    
    // Normalize URLs for more accurate comparison
    const normalizeUrl = (url) => {
      try {
        const normalized = new URL(url);
        // Remove trailing slashes, query parameters, and fragment
        return normalized.origin + normalized.pathname.replace(/\/$/, '');
      } catch (e) {
        debugLog('URL normalization error:', e);
        return url;
      }
    };
    
    const normalizedEntryUrl = normalizeUrl(entry.url);
    debugLog('Normalized URL:', normalizedEntryUrl);
    
    // Check if this URL already exists in our entries (use normalized URLs)
    const existingEntry = entries.find(e => normalizeUrl(e.url) === normalizedEntryUrl);
    if (existingEntry) {
      debugLog('URL already exists in entries, skipping:', entry.url);
      setTimeout(processEntrySaveQueue, 200);
      return;
    }
    
    // Add custom tags if configured
    chrome.storage.local.get(['scrollCaptureTags', 'archivebox_server_url', 'archivebox_api_key'], (tagResult) => {
      debugLog('Server configuration:', {
        serverUrl: tagResult.archivebox_server_url || 'Not configured',
        apiKeySet: tagResult.archivebox_api_key ? 'Yes' : 'No'
      });
      
      const customTags = tagResult.scrollCaptureTags ? 
        tagResult.scrollCaptureTags.split(',').map(tag => tag.trim()) : [];
      
      debugLog('Custom tags:', customTags);
      
      // Extract site tags
      const siteTags = getSiteTags(entry.url);
      debugLog('Site tags:', siteTags);
      
      // Create the full entry object
      const fullEntry = {
        id: crypto.randomUUID(),
        url: entry.url,
        timestamp: entry.timestamp || new Date().toISOString(),
        tags: ['auto-captured', ...siteTags, ...customTags, ...(entry.tags || [])],
        title: entry.title || 'Captured content',
        notes: `Auto-captured content: ${entry.url}`
      };
      
      debugLog('Saving new entry:', fullEntry);
      entries.push(fullEntry);
      
      chrome.storage.local.set({ entries }, () => {
        debugLog('Entry saved to local storage');
        // Process next item after a delay - increased for better throttling
        setTimeout(processEntrySaveQueue, 500);
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog('Message received:', message.type || message.action);
  
  // Handle opening options page
  if (message.action === 'openOptionsPage') {
    const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    debugLog('Opening options page:', options_url);
    chrome.tabs.create({ url: options_url });
  }
  
  // Handle archivebox_add
  if (message.type === 'archivebox_add') {
    debugLog('ArchiveBox add request');
    addToArchiveBox(message.body, sendResponse, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle content capture
  if (message.type === 'capture') {
    debugLog('Capture request received:', message.entry.url);
    saveEntry(message.entry);
    sendResponse({ success: true });
  }

  // Add the new handler for getEnableStatus
  if (message.type === 'getEnableStatus') {
    chrome.storage.local.get(['enableScrollCapture'], (result) => {
      sendResponse({ enableScrollCapture: !!result.enableScrollCapture });
    });
    return true; // Keep the message channel open for async response
  }
  
  return true; // Indicate async response
});

chrome.action.onClicked.addListener(async (tab) => {
  debugLog('Extension icon clicked on tab:', tab.url);
  
  // Don't try to execute script on chrome:// URLs
  if (tab.url.startsWith('chrome://')) {
    debugLog('Cannot execute on chrome:// URL, skipping');
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
  
  debugLog('Created entry from tab click:', entry);
  
  // Save the entry first
  const { entries = [] } = await chrome.storage.local.get('entries');
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  debugLog('Entry saved to local storage');
  
  // Inject scripts
  debugLog('Injecting popup script into tab');
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
  debugLog('Context menu save clicked for tab:', tab.url);
  
  // Don't try to execute script on chrome:// URLs
  if (tab.url.startsWith('chrome://')) {
    debugLog('Cannot execute on chrome:// URL, skipping');
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
  
  debugLog('Created entry from context menu:', entry);
  
  // Save the entry first
  const { entries = [] } = await chrome.storage.local.get('entries');
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  debugLog('Entry saved to local storage');
  
  // Inject scripts
  debugLog('Injecting popup script into tab');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  }).catch(err => {
    console.error('Error injecting script:', err);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  debugLog('Extension installed or updated');
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});

// Replace the saveEntry function with this throttled version
function saveEntry(entry) {
  // Don't save if no URL
  if (!entry || !entry.url) {
    debugLog('Invalid entry, not saving', entry);
    return;
  }
  
  debugLog('Queueing entry for saving:', entry.url);
  
  // Add to queue
  entrySaveQueue.push(entry);
  
  // Start processing if not already running
  if (!processingQueue) {
    debugLog('Starting queue processor');
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
    debugLog('Error extracting site tags:', e);
    return [];
  }
}

// Setup content capture for Reddit
function setupContentCapture() {
  debugLog('Setting up content capture listeners');
  // Setup page load detection
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only run once the page is fully loaded
    if (changeInfo.status !== 'complete') return;
    
    // Only run on Reddit
    if (!tab.url.includes('reddit.com')) return;
    
    debugLog('Reddit page loaded, initializing capture:', tab.url);
    
    // Execute the content script immediately after page load
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      function: setupPageCapture
    }).catch(err => {
      console.error('Error setting up page capture:', err);
      debugLog('Error details:', {
        message: err.message,
        tabUrl: tab.url,
        tabId: tabId
      });
    });
  });
}

// Call this function when the extension starts
chrome.runtime.onStartup.addListener(() => {
  debugLog('Extension started');
  setupContentCapture();
  
  // Check for existing Reddit tabs
  chrome.tabs.query({url: "*://*.reddit.com/*"}, (tabs) => {
    debugLog(`Found ${tabs.length} existing Reddit tabs`);
    
    tabs.forEach(tab => {
      debugLog(`Setting up Reddit capture on existing tab: ${tab.id} - ${tab.url}`);
      chrome.scripting.executeScript({
        target: {tabId: tab.id},
        function: setupPageCapture
      }).catch(err => {
        console.error('Error setting up page capture on existing tab:', err);
      });
    });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  debugLog('Extension installed');
  setupContentCapture();
});

// This function sets up the content capture on Reddit pages
function setupPageCapture() {
  // Local logging function
  function localLog(message, data) {
    console.log('[ArchiveBox]', message, data || '');
  }

  localLog('Setting up page capture', {
    url: window.location.href,
    windowSize: `${window.innerWidth}x${window.innerHeight}`
  });
  
  // Use window variables instead of chrome.storage for state tracking
  if (window.archiveBoxSetupComplete) {
    localLog('Setup already completed for this tab');
    scanVisiblePosts();
    return;
  }
  
  // Mark as setup complete using window variable
  window.archiveBoxSetupComplete = true;
  window.archiveBoxProcessedElements = new Set();
  window.archiveBoxCaptureQueue = [];
  window.archiveBoxStatusQueue = [];
  
  localLog('Performing initial setup');
  
  // Setup throttled submission process
  window.archiveBoxProcessingQueue = false;
  
  function processQueue() {
    if (window.archiveBoxCaptureQueue.length === 0) {
      window.archiveBoxProcessingQueue = false;
      localLog('Capture queue empty, stopping processor');
      return;
    }
    
    window.archiveBoxProcessingQueue = true;
    const entry = window.archiveBoxCaptureQueue.shift();
    localLog('Processing from capture queue:', entry.url);
    
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
      localLog('Adding to capture queue:', entry.url);
      window.archiveBoxCaptureQueue.push(entry);
      
      // Start queue processing if not already running
      if (!window.archiveBoxProcessingQueue) {
        localLog('Starting capture queue processor');
        processQueue();
      }
    } else {
      localLog('URL already in queue, skipping:', entry.url);
    }
  };
  
  // Create enhanced status indicator if it doesn't exist
  if (!document.getElementById('archiveBoxStatusIndicator')) {
    localLog('Creating status indicator');
    const indicator = document.createElement('div');
    indicator.id = 'archiveBoxStatusIndicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-size: 12px;
      z-index: 9999;
      transition: opacity 0.5s;
      opacity: 0;
      max-width: 300px;
      max-height: 200px;
      overflow-y: auto;
      line-height: 1.3;
    `;
    document.body.appendChild(indicator);
    
    // Create a container for the message list
    const messageContainer = document.createElement('div');
    messageContainer.id = 'archiveBoxStatusMessages';
    indicator.appendChild(messageContainer);
    
    // Create a count indicator
    const countIndicator = document.createElement('div');
    countIndicator.id = 'archiveBoxStatusCount';
    countIndicator.style.cssText = `
      margin-top: 5px;
      font-weight: bold;
      text-align: center;
      border-top: 1px solid rgba(255, 255, 255, 0.3);
      padding-top: 5px;
    `;
    indicator.appendChild(countIndicator);
  }
  
  // Improved function to show multiple status messages
  window.showArchiveBoxStatus = (message) => {
    const indicator = document.getElementById('archiveBoxStatusIndicator');
    const messageContainer = document.getElementById('archiveBoxStatusMessages');
    const countIndicator = document.getElementById('archiveBoxStatusCount');
    
    if (!indicator || !messageContainer || !countIndicator) {
      localLog('Status indicator elements not found');
      return;
    }
    
    // Add this message to the queue
    if (!window.archiveBoxStatusQueue) window.archiveBoxStatusQueue = [];
    window.archiveBoxStatusQueue.push(message);
    localLog('Added to status queue:', message);
    
    // Limit queue to last 5 items
    if (window.archiveBoxStatusQueue.length > 5) {
      window.archiveBoxStatusQueue.shift();
    }
    
    // Update the messages display
    messageContainer.innerHTML = window.archiveBoxStatusQueue.map(msg => 
      `<div>• ${msg}</div>`
    ).join('');
    
    // Update count
    countIndicator.textContent = `Captured ${window.archiveBoxStatusQueue.length} posts`;
    
    // Show the indicator
    indicator.style.opacity = '1';
    
    // Hide after a longer delay to account for multiple captures
    clearTimeout(window.archiveBoxStatusTimeout);
    window.archiveBoxStatusTimeout = setTimeout(() => {
      indicator.style.opacity = '0';
      // Clear the queue after hiding
      setTimeout(() => {
        window.archiveBoxStatusQueue = [];
      }, 500);
    }, 3000);
  };
  
  // Store processed elements in window variables
  window.markElementAsProcessed = (elementId) => {
    if (!window.archiveBoxProcessedElements) window.archiveBoxProcessedElements = new Set();
    window.archiveBoxProcessedElements.add(elementId);
    localLog('Marked as processed:', elementId);
  };
  
  // Check if element is processed
  window.isElementProcessed = (elementId) => {
    if (!window.archiveBoxProcessedElements) return false;
    const isProcessed = window.archiveBoxProcessedElements.has(elementId);
    if (isProcessed) {
      localLog('Element already processed, skipping:', elementId);
    }
    return isProcessed;
  };
  
  // Improved scroll event listener with throttling
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    // Cancel any pending scan
    if (scrollTimeout) clearTimeout(scrollTimeout);
    
    // Schedule a new scan after user stops scrolling for 300ms
    scrollTimeout = setTimeout(() => {
      localLog('Scroll detected, scanning visible posts');
      scanVisiblePosts();
    }, 300);
  });
  
  // Handle window resize events to capture posts that become visible
  window.addEventListener('resize', () => {
    if (window.archiveBoxResizeTimer) clearTimeout(window.archiveBoxResizeTimer);
    window.archiveBoxResizeTimer = setTimeout(() => {
      localLog('Window resized, scanning for newly visible posts');
      scanVisiblePosts();
    }, 500);
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
          localLog('Mutation observer detected new posts');
          scanVisiblePosts();
        }, 100);
      }
    };
    
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);
    
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);
    localLog('Mutation observer started');
  };
  
  // Start the mutation observer
  observeNewContent();
  
  // Do initial scan with a small delay to ensure page is fully loaded
  localLog('Performing initial scan');
  setTimeout(() => {
    scanVisiblePosts();
  }, 300);
  
  function scanVisiblePosts() {
    // Check enable status by sending a message to background script
    chrome.runtime.sendMessage({type: 'getEnableStatus'}, (response) => {
      const isEnabled = response && response.enableScrollCapture;
      
      if (!isEnabled) {
        localLog('Automatic content capture disabled, not scanning posts');
        return;
      }
      
      localLog('Scanning visible posts, window size:', window.innerWidth, 'x', window.innerHeight);
      
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
          
          localLog('Found Reddit post:', {
            title: postTitle,
            subreddit: subreddit,
            url: fullUrl
          });
          
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
          
          localLog('Found Old Reddit post:', {
            title: title,
            subreddit: subreddit,
            url: fullUrl
          });
          
          return {
            url: fullUrl,
            title: title,
            tags: ['reddit', subreddit]
          };
        }
        return null;
      });
    });
  }
  
  function scanElements(selector, extractFn) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      localLog(`Found ${elements.length} elements matching '${selector}'`);
    } else {
      localLog(`No elements found matching '${selector}'`);
    }
    
    Array.from(elements).forEach(element => {
      // Generate a unique ID for this element if it doesn't have one
      const elementId = element.id || `archivebox-${selector}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      if (!element.id) {
        element.id = elementId;
        localLog('Assigned ID to element:', elementId);
      }
      
      // Skip already processed elements
      if (window.isElementProcessed(elementId)) return;
      
      // Check if element is at least partially visible in viewport
      const rect = element.getBoundingClientRect();
      
      // New visibility check: ANY part of the element is visible
      const isPartiallyVisible = (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
      );
      
      // Only process partially visible elements
      if (!isPartiallyVisible) {
        localLog('Element not visible in viewport, skipping:', elementId);
        return;
      }
      
      localLog('Element visible in viewport:', elementId);
      
      // Extract entry data
      const entry = extractFn(element);
      if (!entry) {
        localLog('Failed to extract entry data from element:', elementId);
        return;
      }
      
      // Mark as processed using new method
      window.markElementAsProcessed(elementId);
      
      // Add to throttled queue
      window.queueCaptureEntry(entry);
      
      // Show status with improved status indicator
      window.showArchiveBoxStatus(`${entry.title.substring(0, 40)}...`);
      
      localLog(`Queued for capture: ${entry.url} (window size: ${window.innerWidth}x${window.innerHeight})`);
    });
  }
}

// This global event listener ensures we capture Reddit posts after page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process complete loads on Reddit
  if (changeInfo.status !== 'complete' || !tab.url.includes('reddit.com')) return;
  
  debugLog('Reddit tab updated to complete:', tab.url);
  
  // Wait a moment for the page to fully render
  setTimeout(() => {
    debugLog('Executing setupPageCapture after delay');
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      function: setupPageCapture
    }).catch(err => {
      console.error('Error setting up page capture:', err);
      debugLog('Error setting up page capture:', {
        message: err.message,
        tabId: tabId,
        url: tab.url
      });
    });
  }, 1500);
});

// Handle existing Reddit tabs on startup or install
function setupExistingTabs() {
  debugLog('Checking for existing Reddit tabs');
  
  chrome.tabs.query({url: "*://*.reddit.com/*"}, (tabs) => {
    debugLog(`Found ${tabs.length} existing Reddit tabs`);
    
    tabs.forEach(tab => {
      debugLog(`Setting up Reddit capture on existing tab: ${tab.id} - ${tab.url}`);
      chrome.scripting.executeScript({
        target: {tabId: tab.id},
        function: setupPageCapture
      }).catch(err => {
        console.error('Error setting up page capture on existing tab:', err);
        debugLog('Error details:', {
          message: err.message,
          tabId: tab.id,
          url: tab.url
        });
      });
    });
  });
}

// Call this function when the extension starts or is installed
chrome.runtime.onStartup.addListener(setupExistingTabs);
chrome.runtime.onInstalled.addListener(setupExistingTabs);
