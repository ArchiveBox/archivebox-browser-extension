// background.js

import { addToArchiveBox } from "./utils.js";
import * as RedditHandler from "./reddit-handler.js";

// Debug configuration
const DEBUG_MODE = true; // Set to true to see debugging info

// Configuration
const CONFIG = {
  MAX_ENTRIES: 10000, // Maximum number of entries to store locally
  STATUS_DISPLAY_TIME: 3000 // Time in ms to show status indicators
};

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[ArchiveBox Debug]', ...args);
  }
}

// State management - sites handlers registry
const siteHandlers = {
  reddit: RedditHandler
};

// Content capture configuration
let captureEnabled = false;

// Initialize background script
async function initialize() {
  debugLog('Initializing background script');
  
  // Load configuration
  const { enableScrollCapture } = await chrome.storage.local.get('enableScrollCapture');
  captureEnabled = !!enableScrollCapture;
  
  // Initialize site handlers
  if (captureEnabled) {
    debugLog('Content capture is enabled, initializing handlers');
    Object.values(siteHandlers).forEach(handler => {
      if (typeof handler.initialize === 'function') {
        handler.initialize();
      }
    });
  }
  
  // Check all existing tabs to find any supported site tabs already open
  chrome.tabs.query({}, (tabs) => {
    if (captureEnabled) {
      debugLog(`Found ${tabs.length} existing tabs, checking for supported sites`);
      
      // Check each tab for supported sites
      tabs.forEach(tab => {
        if (tab.url) {
          Object.entries(siteHandlers).forEach(([site, handler]) => {
            if (handler.shouldCaptureUrl && handler.shouldCaptureUrl(tab.url)) {
              debugLog(`Found existing ${site} tab:`, tab.url);
              if (handler.injectContentScript) {
                handler.injectContentScript(tab.id);
              }
            }
          });
        }
      });
    }
  });
  
  debugLog('Background script initialized');
}

/**
 * Listens for messages from content scripts and popup
 */
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
    
    if (!captureEnabled) {
      debugLog('Content capture is disabled, ignoring capture request');
      sendResponse({ success: false, reason: 'Capture disabled' });
      return true;
    }
    
    // Determine site handler based on URL or tags
    const url = message.entry.url;
    let handled = false;
    
    // Check if it's from Reddit
    if (message.entry.tags.includes('reddit') || url.includes('reddit.com')) {
      if (message.entry.priority === 'high') {
        // Use high priority capture for viewport posts
        RedditHandler.captureHighPriority(message.entry, sender.tab?.id);
      } else {
        // Let reddit handler decide what to do
        RedditHandler.queueForCapture(message.entry, sender.tab?.id, 'normal');
      }
      handled = true;
    }
    
    // Generic handling for other sites or if no specific handler was found
    if (!handled) {
      saveEntry(message.entry);
    }
    
    sendResponse({ success: true });
  }

  // Enable status requests
  if (message.type === 'getEnableStatus') {
    chrome.storage.local.get(['enableScrollCapture'], (result) => {
      sendResponse({ enableScrollCapture: !!result.enableScrollCapture });
    });
    return true; // Keep the message channel open for async response
  }
  
  // Show status notification in tabs
  if (message.type === 'showStatus') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (tabId) {
      try {
        showStatusInTab(tabId, message.message, message.count, message.immediate);
      } catch (err) {
        debugLog('Error showing status:', err);
      }
    }
    sendResponse({ success: true });
  }
  
  // Get site handler stats
  if (message.type === 'getStats') {
    const stats = {};
    Object.entries(siteHandlers).forEach(([site, handler]) => {
      if (handler.getStats) {
        stats[site] = handler.getStats();
      }
    });
    sendResponse({ stats });
    return true;
  }
  if (message.type === 'getSiteHandlerForUrl') {
    try {
      const url = message.url;
      const handlerResult = findHandlerForUrl(url);
      
      if (handlerResult) {
        const { id, handler } = handlerResult;
        const handlers = getAllHandlers();
        const handlerInfo = handlers[id];
        
        sendResponse({
          found: true,
          handler: {
            id,
            name: handlerInfo.name,
            description: handlerInfo.description,
            version: handlerInfo.version
          }
        });
      } else {
        sendResponse({ found: false });
      }
    } catch (error) {
      console.error('Error finding handler for URL:', error);
      sendResponse({ found: false, error: error.message });
    }
    return true;
  }
  
  // Get all site handlers
  if (message.type === 'getSiteHandlers') {
    try {
      const handlers = getAllHandlers();
      sendResponse({ handlers });
    } catch (error) {
      console.error('Error getting site handlers:', error);
      sendResponse({ handlers: {} });
    }
    return true;
  }
  
  // URL visited notification
  if (message.type === 'urlVisited') {
    try {
      const url = message.url;
      const handlerResult = findHandlerForUrl(url);
      
      if (handlerResult && typeof handlerResult.handler.onUrlVisited === 'function') {
        handlerResult.handler.onUrlVisited(url);
      }
      
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error handling URL visit:', error);
      sendResponse({ success: false });
    }
    return true;
  }
  
  // Configuration change notification
  if (message.type === 'captureConfigChanged') {
    try {
      const { config } = message;
      
      // Update enabled state
      captureEnabled = !!config.enableScrollCapture;
      
      // Notify handlers
      Object.values(siteHandlers).forEach(handler => {
        if (typeof handler.onConfigChanged === 'function') {
          handler.onConfigChanged(config);
        }
      });
      
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error handling config change:', error);
      sendResponse({ success: false });
    }
    return true;
  }
  
  return true; // Indicate async response
});

/**
 * Handle click on extension icon
 */
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
  
  // Inject popup script
  debugLog('Injecting popup script into tab');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  }).catch(err => {
    console.error('Error injecting script:', err);
  });
});

/**
 * Handle context menu click
 */
chrome.contextMenus.onClicked.addListener(async function(item, tab) {
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
  
  // Inject popup script
  debugLog('Injecting popup script into tab');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  }).catch(err => {
    console.error('Error injecting script:', err);
  });
});

/**
 * Handle extension installation and updates
 */
chrome.runtime.onInstalled.addListener(function () {
  debugLog('Extension installed or updated');
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
  
  // Set up configuration defaults
  initializeConfiguration();
  
  // Initialize the extension
  initialize();
});

/**
 * Set up configuration defaults if needed
 */
async function initializeConfiguration() {
  const config = await chrome.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key',
    'enableScrollCapture',
    'scrollCaptureTags'
  ]);
  
  const updates = {};
  
  // Set default values if undefined
  if (config.archivebox_server_url === undefined) {
    updates.archivebox_server_url = '';
  }
  
  if (config.archivebox_api_key === undefined) {
    updates.archivebox_api_key = '';
  }
  
  if (config.enableScrollCapture === undefined) {
    updates.enableScrollCapture = false;
  }
  
  if (config.scrollCaptureTags === undefined) {
    updates.scrollCaptureTags = '';
  }
  
  // Save defaults if needed
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
    debugLog('Set default config values:', updates);
  }
}

/**
 * Handle new tab creation
 */
chrome.tabs.onCreated.addListener((tab) => {
  // We'll check if it's a supported site tab once the navigation completes
  debugLog('New tab created:', tab.id);
});

/**
 * Handle tab navigation to detect supported sites
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only react when the tab has completed loading and we have a URL
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if content capture is enabled
    const { enableScrollCapture } = await chrome.storage.local.get('enableScrollCapture');
    captureEnabled = !!enableScrollCapture;
    
    if (captureEnabled) {
      debugLog('Tab updated, checking for supported sites:', tab.url);
      
      // Check URL against each site handler
      Object.entries(siteHandlers).forEach(([site, handler]) => {
        if (handler.shouldCaptureUrl && handler.shouldCaptureUrl(tab.url)) {
          debugLog(`Detected ${site} site in tab:`, tab.url);
          if (handler.injectContentScript) {
            handler.injectContentScript(tabId);
          }
        }
      });
    }
  }
});

/**
 * Generic entry saving logic for any URL
 */
async function saveEntry(entry) {
  try {
    if (!entry || !entry.url) {
      debugLog('Invalid entry, not saving', entry);
      return { success: false, reason: 'Invalid entry' };
    }
    
    debugLog('Saving entry:', entry.url);
    
    // Get current entries
    const { entries = [] } = await chrome.storage.local.get('entries');
    
    // Check for duplicates
    const normalizeUrl = (url) => {
      try {
        const normalized = new URL(url);
        return normalized.origin + normalized.pathname.replace(/\/$/, '');
      } catch (e) {
        debugLog('URL normalization error:', e);
        return url;
      }
    };
    
    const normalizedEntryUrl = normalizeUrl(entry.url);
    const existingEntry = entries.find(e => normalizeUrl(e.url) === normalizedEntryUrl);
    
    if (existingEntry) {
      debugLog('URL already exists in entries, skipping:', entry.url);
      return { success: false, reason: 'URL already exists' };
    }
    
    // Add custom tags if configured
    const { scrollCaptureTags } = await chrome.storage.local.get(['scrollCaptureTags']);
    const customTags = scrollCaptureTags ? 
      scrollCaptureTags.split(',').map(tag => tag.trim()) : [];
    
    // Extract site tags
    const siteTags = getSiteTags(entry.url);
    
    // Create the full entry object
    const fullEntry = {
      id: entry.id || crypto.randomUUID(),
      url: entry.url,
      timestamp: entry.timestamp || new Date().toISOString(),
      tags: ['auto-captured', ...siteTags, ...customTags, ...(entry.tags || [])],
      title: entry.title || 'Captured content',
      notes: entry.notes || `Auto-captured content: ${entry.url}`,
      favicon: entry.favicon
    };
    
    // Add to entries
    entries.push(fullEntry);
    
    // Limit entries if exceeding maximum
    if (entries.length > CONFIG.MAX_ENTRIES) {
      // Sort by timestamp (oldest first) and remove excess
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const removed = entries.splice(0, entries.length - CONFIG.MAX_ENTRIES);
      debugLog(`Removed ${removed.length} oldest entries to stay under limit`);
    }
    
    // Save entries
    await chrome.storage.local.set({ entries });
    debugLog('Entry saved to local storage');
    
    return { success: true };
  } catch (e) {
    debugLog('Error saving entry:', e);
    return { success: false, reason: e.message };
  }
}

/**
 * Extract site name for tagging
 */
function getSiteTags(url) {
  try {
    const hostname = new URL(url).hostname;
    const domain = hostname
      .replace('www.', '')
      .replace(/\.(com|org|net|io|gov|edu)$/, '');
    return [domain];
  } catch (e) {
    debugLog('Error extracting site tags:', e);
    return [];
  }
}

/**
 * Show status message in tab
 */
async function showStatusInTab(tabId, message, count, immediate = false) {
  try {
    // Check if tab still exists before proceeding
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        debugLog(`Tab ${tabId} no longer exists, skipping status update`);
        return;
      }
    } catch (e) {
      debugLog(`Tab ${tabId} error or no longer exists:`, e.message);
      return;
    }

    // Setup status indicator if not already present
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: setupStatusIndicator,
    }).catch(err => {
      debugLog(`Error setting up status indicator in tab ${tabId}:`, err.message);
      return;
    });
    
    // Show the status message
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      args: [message, count || 0, immediate],
      function: (message, count, immediate) => {
        // Add to status queue
        if (!window.archiveBoxStatusQueue) window.archiveBoxStatusQueue = [];
        window.archiveBoxStatusQueue.unshift(message);
        
        // Keep only 5 items
        if (window.archiveBoxStatusQueue.length > 5) {
          window.archiveBoxStatusQueue = window.archiveBoxStatusQueue.slice(0, 5);
        }
        
        // Show status
        const indicator = document.getElementById('archiveBoxStatusIndicator');
        const messageContainer = document.getElementById('archiveBoxStatusMessages');
        const countIndicator = document.getElementById('archiveBoxStatusCount');
        
        if (indicator && messageContainer && countIndicator) {
          // Update message list
          messageContainer.innerHTML = window.archiveBoxStatusQueue.map(msg => 
            `<div>• ${msg}</div>`
          ).join('');
          
          // Update count
          countIndicator.textContent = `Captured ${count} posts`;
          
          // Show indicator
          indicator.style.opacity = '1';
          
          // Auto hide
          clearTimeout(window.archiveBoxStatusTimeout);
          window.archiveBoxStatusTimeout = setTimeout(() => {
            indicator.style.opacity = '0';
          }, 3000);
        }
      }
    }).catch(err => {
      debugLog(`Error showing status in tab ${tabId}:`, err.message);
    });
  } catch (err) {
    debugLog('Error showing status:', err);
  }
}

/**
 * Setup status indicator in tab
 */
function setupStatusIndicator() {
  if (!document.getElementById('archiveBoxStatusIndicator')) {
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
    
    // Initialize status queue
    window.archiveBoxStatusQueue = [];
  }
}

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  debugLog('Extension started');
  initialize();
});

