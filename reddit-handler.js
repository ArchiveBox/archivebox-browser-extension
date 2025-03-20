// reddit-handler.js
// Manages all Reddit-specific capture functionality

// Configuration
const CONFIG = {
  CAPTURE_DELAY: 1000, // Delay between captures in ms
  VIEWPORT_CAPTURE_DELAY: 100, // Quicker for visible posts
  MAX_PROCESSED_URLS: 1000, // Maximum number of URLs to keep in memory
  DEBUG_MODE: true,
  BATCH_SIZE: 10, // Number of entries to batch save
  STORAGE_KEY: 'reddit_processed_urls' // Key for storing processed URLs
};

// State management
let processedUrls = new Set();
let captureCount = 0;
let isInitialized = false;

// Queues with priority
const captureQueue = {
  high: [], // Viewport-visible posts
  normal: [], // Background discovered posts
  processing: false
};

/**
 * Debug logging
 */
function debugLog(...args) {
  if (CONFIG.DEBUG_MODE) {
    console.log('[Reddit Handler]', ...args);
  }
}

/**
 * Initialize the Reddit handler
 */
export async function initialize() {
  if (isInitialized) return;
  
  debugLog('Initializing Reddit handler');
  
  // Load previously processed URLs from storage
  const storage = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
  if (storage[CONFIG.STORAGE_KEY]) {
    try {
      const storedUrls = JSON.parse(storage[CONFIG.STORAGE_KEY]);
      processedUrls = new Set(storedUrls);
      debugLog(`Loaded ${processedUrls.size} previously processed URLs`);
    } catch (e) {
      debugLog('Error parsing stored URLs:', e);
      processedUrls = new Set();
    }
  }
  
  // Reset capture count
  captureCount = 0;
  
  // Setup listeners
  setupRedditListeners();
  
  isInitialized = true;
  debugLog('Reddit handler initialized');
  
  // Start queue processor
  processQueue();
}

/**
 * Setup listeners for Reddit-specific functionality
 */
function setupRedditListeners() {
  // Listen for navigation to Reddit post pages
  chrome.webRequest.onCompleted.addListener(
    handleRedditNavigation,
    { urls: ["*://*.reddit.com/*"] },
    []
  );
  
  // Listen for POST requests that might contain Reddit data
  chrome.webRequest.onBeforeRequest.addListener(
    handleRedditApiRequest,
    { urls: ["*://*.reddit.com/*"] },
    ["requestBody"]
  );
}

/**
 * Handle navigation to a Reddit post
 */
async function handleRedditNavigation(details) {
  // Only interested in document navigation
  if (details.type !== 'main_frame' && details.type !== 'sub_frame') {
    return;
  }
  
  // Check if URL contains Reddit and is a post
  if (!details.url.includes('reddit.com') || !isRedditPostUrl(details.url)) {
    return;
  }
  
  // Get settings to see if we should capture
  const { enableScrollCapture } = await chrome.storage.local.get(['enableScrollCapture']);
  if (!enableScrollCapture) {
    return;
  }
  
  debugLog('Detected navigation to Reddit post:', details.url);
  
  // Inject content script for viewport detection
  injectContentScript(details.tabId);
  
  // Wait for page to load title
  setTimeout(async () => {
    try {
      // Get tab info
      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      if (!tab) return;
      
      // Process the URL
      processRedditNavigationUrl(details.url, tab.title, details.tabId);
    } catch (e) {
      debugLog('Error processing Reddit navigation:', e);
    }
  }, 1000);
}

/**
 * Handle Reddit API requests that might contain post data
 */
async function handleRedditApiRequest(details) {
  if (details.method !== "POST") return;
  
  // Check for relevant endpoints
  const isRedditAPIEndpoint = 
    details.url.includes('/svc/shreddit/events') || 
    details.url.includes('/svc/shreddit/graphql') ||
    details.url.includes('/api/');
  
  if (!isRedditAPIEndpoint) return;
  
  // Check if capture is enabled
  const { enableScrollCapture } = await chrome.storage.local.get(['enableScrollCapture']);
  if (!enableScrollCapture) {
    return;
  }
  
  try {
    // Try to parse the request body if available
    if (details.requestBody && details.requestBody.raw) {
      for (const raw of details.requestBody.raw) {
        if (raw.bytes) {
          const decoder = new TextDecoder();
          const text = decoder.decode(raw.bytes);
          
          // Look for post data patterns
          if (text.includes('"post":') && text.includes('"title":')) {
            extractPostsFromJson(text, details.tabId);
          } else if (text.includes('"subreddit_name":') && text.includes('"title":')) {
            extractPostsFromJson(text, details.tabId);
          }
        }
      }
    }
  } catch (e) {
    debugLog('Error processing request body:', e);
  }
}

/**
 * Extract posts from JSON data
 */
function extractPostsFromJson(jsonText, tabId) {
  try {
    // For debugging, log a sample of what we're trying to parse
    debugLog('Parsing JSON data sample:', jsonText.substring(0, 200));
    
    // Try to parse the JSON
    let data = null;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      debugLog('Failed to parse JSON:', e.message);
      return;
    }
    
    // Check for Reddit's specific structure with "info" array
    if (data && data.info && Array.isArray(data.info)) {
      debugLog('Found Reddit info array with', data.info.length, 'items');
      
      // Process each item in the info array
      data.info.forEach(item => {
        // Check if this item has a post object
        if (item && item.post) {
          // Extract the post data
          const post = item.post;
          
          // Check for title field
          if (post.title) {
            debugLog('Found post with title:', post.title);
            
            // Create URL
            let url = '';
            if (post.url && post.url.startsWith('/')) {
              url = 'https://www.reddit.com' + post.url;
            } else if (post.url) {
              url = post.url;
            } else if (post.id && post.id.startsWith('t3_')) {
              // Construct URL from post ID
              const postId = post.id.substring(3);
              
              // Include subreddit if available
              if (post.subreddit_name) {
                const subreddit = post.subreddit_name.replace('r/', '');
                url = `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
              } else {
                url = `https://www.reddit.com/comments/${postId}`;
              }
            }
            
            if (url) {
              // Extract subreddit
              let subreddit = '';
              if (post.subreddit_name) {
                subreddit = post.subreddit_name.replace('r/', '');
              }
              
              // Create post data object
              const postData = {
                url: url,
                title: post.title,
                subreddit: subreddit,
                timestamp: new Date().toISOString()
              };
              
              // Queue the post for processing with normal priority
              queueForCapture(postData, tabId, 'normal');
            }
          }
        }
      });
    }
  } catch (e) {
    debugLog('Error processing JSON data:', e);
  }
}

/**
 * Check if URL is a Reddit post
 */
function isRedditPostUrl(url) {
  try {
    if (!url.includes('reddit.com')) return false;
    
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.includes('/comments/');
  } catch (e) {
    return false;
  }
}

/**
 * Process a Reddit navigation URL
 */
function processRedditNavigationUrl(url, pageTitle, tabId) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/');
    
    // Check for /comments/ format
    if (pathParts.includes('comments')) {
      const commentsIndex = pathParts.indexOf('comments');
      
      // Need at least comment ID
      if (commentsIndex + 1 < pathParts.length) {
        // Get subreddit if present
        let subreddit = '';
        if (pathParts[1] === 'r' && pathParts[2]) {
          subreddit = pathParts[2];
        }
        
        // Clean up title
        let title = pageTitle || '';
        if (title.includes(' - Reddit')) {
          title = title.split(' - Reddit')[0].trim();
        }
        
        // Create post data
        const postData = {
          url: url,
          title: title || 'Reddit Post',
          subreddit: subreddit,
          timestamp: new Date().toISOString()
        };
        
        // Queue for processing with normal priority
        queueForCapture(postData, tabId, 'normal');
      }
    }
  } catch (e) {
    debugLog('Error processing Reddit URL:', e);
  }
}

/**
 * Queue a post for capture with priority
 */
function queueForCapture(postData, tabId, priority = 'normal') {
  if (!postData || !postData.url || !postData.title) {
    debugLog('Invalid post data, skipping:', postData);
    return;
  }
  
  // Normalize URL to avoid duplicates
  const normalizedUrl = normalizeRedditUrl(postData.url);
  
  // Skip if already processed
  if (processedUrls.has(normalizedUrl)) {
    debugLog('Skipping already processed URL:', normalizedUrl);
    return;
  }
  
  debugLog(`Queueing Reddit post with ${priority} priority:`, postData.title);
  
  // Add to appropriate queue
  captureQueue[priority].push({
    data: postData,
    tabId: tabId,
    queuedAt: Date.now()
  });
  
  // Start processing if not already running
  if (!captureQueue.processing) {
    processQueue();
  }
}

/**
 * Process the capture queue
 */
async function processQueue() {
  if (captureQueue.high.length === 0 && captureQueue.normal.length === 0) {
    captureQueue.processing = false;
    debugLog('Queue empty, stopping processor');
    return;
  }
  
  captureQueue.processing = true;
  
  // Process high priority queue first
  let item;
  let delay;
  
  if (captureQueue.high.length > 0) {
    item = captureQueue.high.shift();
    delay = CONFIG.VIEWPORT_CAPTURE_DELAY;
  } else {
    item = captureQueue.normal.shift();
    delay = CONFIG.CAPTURE_DELAY;
  }
  
  // Get age of item in queue
  const queueAge = Date.now() - item.queuedAt;
  debugLog(`Processing post from queue (age: ${queueAge}ms):`, item.data.title);
  
  // Normalize URL for deduplication
  const normalizedUrl = normalizeRedditUrl(item.data.url);
  
  // Mark as processed
  addToProcessedUrls(normalizedUrl);
  captureCount++;
  
  // Create entry object
  const entry = {
    url: item.data.url,
    title: item.data.title,
    timestamp: item.data.timestamp,
    tags: ['reddit', item.data.subreddit].filter(Boolean)
  };
  
  // Process the entry
  await saveEntry(entry);
  
  // Show status in tab - check if tab still exists first
  try {
    const tab = await chrome.tabs.get(item.tabId);
    if (tab) {
      chrome.runtime.sendMessage({
        type: 'showStatus',
        message: `${entry.title.substring(0, 40)}...`,
        count: captureCount,
        tabId: item.tabId
      });
    }
  } catch (err) {
    debugLog(`Tab ${item.tabId} doesn't exist anymore, skipping status update`);
  }
  
  // Schedule next item with delay
  setTimeout(processQueue, delay);
}

/**
 * Add URL to processed URLs and manage the size limit
 */
function addToProcessedUrls(url) {
  processedUrls.add(url);
  
  // If we've exceeded the limit, remove oldest items
  // This is approximate since Sets don't guarantee order
  if (processedUrls.size > CONFIG.MAX_PROCESSED_URLS) {
    const urlsArray = Array.from(processedUrls);
    const toRemove = urlsArray.slice(0, urlsArray.length - CONFIG.MAX_PROCESSED_URLS);
    toRemove.forEach(u => processedUrls.delete(u));
    debugLog(`Removed ${toRemove.length} old URLs from processed set`);
  }
  
  // Periodically save processed URLs to storage
  if (processedUrls.size % 50 === 0) {
    persistProcessedUrls();
  }
}

/**
 * Save processed URLs to storage
 */
async function persistProcessedUrls() {
  const urlsArray = Array.from(processedUrls);
  await chrome.storage.local.set({
    [CONFIG.STORAGE_KEY]: JSON.stringify(urlsArray)
  });
  debugLog(`Saved ${urlsArray.length} processed URLs to storage`);
}

/**
 * Normalize Reddit URL to avoid duplicates
 */
function normalizeRedditUrl(url) {
  try {
    const parsedUrl = new URL(url);
    
    // Extract essential parts (subreddit & post ID)
    const parts = parsedUrl.pathname.split('/');
    const commentsIndex = parts.indexOf('comments');
    
    if (commentsIndex > 0 && commentsIndex + 1 < parts.length) {
      // Get post ID
      const postId = parts[commentsIndex + 1];
      
      // Get subreddit if available
      let subreddit = '';
      if (parts[1] === 'r' && parts[2]) {
        subreddit = parts[2];
      }
      
      // Create canonical URL
      if (subreddit) {
        return `${parsedUrl.origin}/r/${subreddit}/comments/${postId}`;
      } else {
        return `${parsedUrl.origin}/comments/${postId}`;
      }
    }
    
    // Fallback to removing query params and fragments
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch (e) {
    debugLog('Error normalizing URL:', e);
    return url;
  }
}

/**
 * Save entry to local storage
 * Eventually used for batch saving
 */
async function saveEntry(entry) {
  try {
    // Add custom tags if configured
    const { scrollCaptureTags } = await chrome.storage.local.get(['scrollCaptureTags']);
    const customTags = scrollCaptureTags ? 
      scrollCaptureTags.split(',').map(tag => tag.trim()) : [];
    
    // Create the full entry object
    const fullEntry = {
      id: crypto.randomUUID(),
      url: entry.url,
      timestamp: entry.timestamp || new Date().toISOString(),
      tags: ['auto-captured', 'reddit', ...customTags, ...(entry.tags || [])],
      title: entry.title || 'Reddit Post',
      notes: `Auto-captured from Reddit: ${entry.url}`
    };
    
    // Save to storage
    const { entries = [] } = await chrome.storage.local.get('entries');
    
    // Normalize URLs for more accurate comparison
    const normalizeUrl = (url) => {
      try {
        const normalized = new URL(url);
        return normalized.origin + normalized.pathname.replace(/\/$/, '');
      } catch (e) {
        return url;
      }
    };
    
    // Check if this URL already exists in our entries
    const normalizedEntryUrl = normalizeUrl(entry.url);
    const existingEntry = entries.find(e => normalizeUrl(e.url) === normalizedEntryUrl);
    
    if (!existingEntry) {
      entries.push(fullEntry);
      await chrome.storage.local.set({ entries });
      debugLog('Entry saved to local storage:', fullEntry.title);
    } else {
      debugLog('URL already exists in entries, skipping:', entry.url);
    }
  } catch (e) {
    debugLog('Error saving entry:', e);
  }
}

/**
 * Inject content script for viewport detection
 */
export async function injectContentScript(tabId) {
  try {
    const { enableScrollCapture } = await chrome.storage.local.get(['enableScrollCapture']);
    if (!enableScrollCapture) {
      debugLog('Reddit capture is disabled in settings, not injecting content script');
      return;
    }
    
    debugLog('Injecting Reddit content script into tab:', tabId);
    
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['reddit-content.js']
    });
    
    debugLog('Content script injected successfully');
  } catch (err) {
    debugLog('Error injecting content script:', err.message);
  }
}

/**
 * Handle high priority capture request from content script
 */
export function captureHighPriority(entry, tabId) {
  debugLog('Received high priority capture request from content script:', entry.url);
  
  // Create post data object
  const postData = {
    url: entry.url,
    title: entry.title,
    subreddit: entry.tags.find(tag => tag !== 'reddit' && tag !== 'viewport-captured'),
    timestamp: entry.timestamp
  };
  
  // Queue with high priority
  queueForCapture(postData, tabId, 'high');
}

/**
 * Clear all queues and reset
 */
export function reset() {
  captureQueue.high = [];
  captureQueue.normal = [];
  captureQueue.processing = false;
  captureCount = 0;
  debugLog('Reddit handler reset');
}

/**
 * Public method to check if we should capture the current URL
 */
export function shouldCaptureUrl(url) {
  if (!url.includes('reddit.com')) return false;
  return isRedditPostUrl(url);
}

/**
 * Get stats about the Reddit handler
 */
export function getStats() {
  return {
    captureCount,
    processedUrlsCount: processedUrls.size,
    highPriorityQueueLength: captureQueue.high.length,
    normalPriorityQueueLength: captureQueue.normal.length
  };
}
