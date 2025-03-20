// site-handlers.js
// Registry for all site-specific handlers

import * as RedditHandler from './reddit-handler.js';


// Debug configuration
const DEBUG = true;

// Debug logging
function debugLog(...args) {
  if (DEBUG) {
    console.log('[Site Handlers]', ...args);
  }
}

// Registry of all available site handlers
const handlers = {
  // Reddit handler
  reddit: {
    name: 'Reddit',
    module: RedditHandler,
    domains: ['reddit.com'],
    description: 'Automatically captures Reddit posts while browsing',
    version: '1.0.0',
    author: 'ArchiveBox'
  }
  
  // Add more site handlers here following the same format
  // For example:
  /*
  twitter: {
    name: 'Twitter',
    module: TwitterHandler,
    domains: ['twitter.com', 'x.com'],
    description: 'Captures tweets and threads',
    version: '1.0.0',
    author: 'ArchiveBox'
  }
  */
};

/**
 * Initialize all site handlers
 */
export async function initializeAll() {
  debugLog('Initializing all site handlers');
  
  // Check if site capture is enabled
  const { enableScrollCapture } = await chrome.storage.local.get('enableScrollCapture');
  
  if (!enableScrollCapture) {
    debugLog('Site capture is disabled, skipping initialization');
    return;
  }
  
  // Initialize each handler
  for (const [id, handler] of Object.entries(handlers)) {
    if (handler.module && typeof handler.module.initialize === 'function') {
      try {
        debugLog(`Initializing ${handler.name} handler`);
        await handler.module.initialize();
      } catch (error) {
        console.error(`Error initializing ${handler.name} handler:`, error);
      }
    }
  }
  
  debugLog('All site handlers initialized');
}

/**
 * Get a specific handler by ID
 */
export function getHandler(handlerId) {
  return handlers[handlerId]?.module;
}

/**
 * Find a handler for a specific URL
 */
export function findHandlerForUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    for (const [id, handler] of Object.entries(handlers)) {
      if (handler.domains.some(domain => hostname.includes(domain))) {
        return { id, handler: handler.module };
      }
    }
  } catch (error) {
    console.error('Error finding handler for URL:', error);
  }
  
  return null;
}

/**
 * Handle capture request from content script
 */
export async function handleCaptureRequest(entry, tabId) {
  const handlerResult = findHandlerForUrl(entry.url);
  
  if (handlerResult) {
    debugLog(`Using ${handlerResult.id} handler for ${entry.url}`);
    
    if (entry.priority === 'high' && typeof handlerResult.handler.captureHighPriority === 'function') {
      return handlerResult.handler.captureHighPriority(entry, tabId);
    } else if (typeof handlerResult.handler.captureNormal === 'function') {
      return handlerResult.handler.captureNormal(entry, tabId);
    }
  }
  
  // No specific handler found, use generic method
  debugLog(`No specific handler for ${entry.url}, using generic method`);
  return saveGenericEntry(entry);
}

/**
 * Save a generic entry
 */
async function saveGenericEntry(entry) {
  try {
    if (!entry || !entry.url) {
      return { success: false, reason: 'Invalid entry' };
    }
    
    // Get current entries
    const { entries = [] } = await chrome.storage.local.get('entries');
    
    // Check for duplicates
    const normalizeUrl = (url) => {
      try {
        const normalized = new URL(url);
        return normalized.origin + normalized.pathname.replace(/\/$/, '');
      } catch (e) {
        return url;
      }
    };
    
    const normalizedEntryUrl = normalizeUrl(entry.url);
    const existingEntry = entries.find(e => normalizeUrl(e.url) === normalizedEntryUrl);
    
    if (existingEntry) {
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
    
    // Save entries
    await chrome.storage.local.set({ entries });
    
    return { success: true };
  } catch (e) {
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
    return [];
  }
}

/**
 * Check a specific URL against all site handlers
 */
export function shouldCaptureUrl(url) {
  try {
    const handlerResult = findHandlerForUrl(url);
    
    if (handlerResult && handlerResult.handler.shouldCaptureUrl) {
      return handlerResult.handler.shouldCaptureUrl(url);
    }
  } catch (error) {
    console.error('Error checking if URL should be captured:', error);
  }
  
  return false;
}

/**
 * Inject appropriate content script for a URL
 */
export async function injectContentScriptForUrl(url, tabId) {
  try {
    const handlerResult = findHandlerForUrl(url);
    
    if (handlerResult && handlerResult.handler.injectContentScript) {
      await handlerResult.handler.injectContentScript(tabId);
      return true;
    }
  } catch (error) {
    console.error('Error injecting content script:', error);
  }
  
  return false;
}

/**
 * Get stats from all handlers
 */
export function getAllStats() {
  const stats = {};
  
  for (const [id, handler] of Object.entries(handlers)) {
    if (handler.module && typeof handler.module.getStats === 'function') {
      stats[id] = handler.module.getStats();
    }
  }
  
  return stats;
}

/**
 * Get all handlers
 * Returns the complete registry of site handlers with their metadata
 * @returns {Object} Object containing all registered handlers with their metadata
 */
export function getAllHandlers() {
  return handlers;
}

// Export all handlers for direct access
export const Reddit = RedditHandler;
