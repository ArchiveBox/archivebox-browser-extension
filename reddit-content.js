// reddit-content.js
// Content script for detecting Reddit posts in the viewport with improved architecture

// Configuration
const CONFIG = {
  OBSERVATION_THRESHOLD: 0.4,  // Post must be 40% visible to trigger capture
  ROOT_MARGIN: "100px",        // Extend detection area beyond viewport
  QUEUE_PROCESS_DELAY: 100,    // Delay between processing items in queue
  MUTATION_OBSERVER_DELAY: 150, // Delay after DOM changes before finding new posts
  MAX_PROCESSED_POSTS: 1000,   // Maximum number of processed post IDs to store
  DEBUG_MODE: true             // Enable debug logging
};

// State management
const state = {
  observedPosts: new Set(),    // Posts we've already seen and processed
  postQueue: [],               // Queue of posts to process in positional order
  isProcessingQueue: false,    // Whether we're currently processing the queue
  captureCount: 0,             // Number of posts captured in this session
  isEnabled: false,            // Whether capture is enabled
  isInitialized: false         // Whether we've initialized the system
};

/**
 * Debug logging
 */
function debugLog(...args) {
  if (CONFIG.DEBUG_MODE) {
    console.log('[ArchiveBox Reddit]', ...args);
  }
}

/**
 * Process posts in order from top to bottom of page
 */
function processNextPost() {
  if (state.postQueue.length === 0) {
    state.isProcessingQueue = false;
    return;
  }
  
  state.isProcessingQueue = true;
  
  // Sort post queue by Y position (top to bottom)
  state.postQueue.sort((a, b) => a.position - b.position);
  
  // Process the topmost post
  const postToProcess = state.postQueue.shift();
  capturePost(postToProcess.postElement, postToProcess.postId);
  
  // Continue processing the queue with a small delay to prevent UI blocking
  setTimeout(processNextPost, CONFIG.QUEUE_PROCESS_DELAY);
}

/**
 * Queue a post for capture based on its position in the viewport
 */
function queuePostForCapture(postElement, postId) {
  // Get the vertical position of the post
  const rect = postElement.getBoundingClientRect();
  const position = rect.top;
  
  // Add to queue with position data
  state.postQueue.push({
    postElement,
    postId,
    position
  });
  
  // Start processing queue if not already running
  if (!state.isProcessingQueue) {
    processNextPost();
  }
}

/**
 * Extract useful information from a post element
 */
function extractPostData(postElement, postId) {
  // Extract post details - try different selectors to handle Reddit's different UI versions
  const titleElement = postElement.querySelector(
    'h1, h3, [data-testid="post-title"], [data-click-id="body"] h2, a.title'
  );
  
  const linkElement = postElement.querySelector(
    'a.title, [data-click-id="body"], a[data-click-id="comments"], [data-testid="post-title"] a'
  );
  
  if (!titleElement) {
    debugLog('Could not find title element in post:', postId);
    return null;
  }
  
  // Get title
  const title = titleElement.textContent.trim();
  
  // Get permalink/URL
  let url = '';
  if (linkElement && linkElement.href) {
    url = linkElement.href;
  } else {
    // Try to construct URL from post ID if it matches Reddit's post ID format
    const redditId = postId.replace('t3_', '');
    if (redditId.length >= 6) {
      // Try to extract subreddit
      const subredditElement = postElement.querySelector('a[href^="/r/"]');
      const subredditName = subredditElement ? subredditElement.textContent.replace('r/', '') : '';
      
      if (subredditName) {
        url = `https://www.reddit.com/r/${subredditName}/comments/${redditId}/`;
      } else {
        url = `https://www.reddit.com/comments/${redditId}/`;
      }
    }
  }
  
  if (!title || !url) {
    debugLog('Insufficient data for post, skipping');
    return null;
  }
  
  // Get subreddit
  const subredditElement = postElement.querySelector('a[href^="/r/"]');
  const subreddit = subredditElement ? subredditElement.textContent.replace('r/', '') : '';
  
  return {
    url,
    title,
    subreddit
  };
}

/**
 * Capture post data and send to background script
 */
function capturePost(postElement, postId) {
  // Only capture the post if we haven't already processed it
  if (state.observedPosts.has(postId)) return;
  
  // Mark as processed and manage the max size of observedPosts
  state.observedPosts.add(postId);
  if (state.observedPosts.size > CONFIG.MAX_PROCESSED_POSTS) {
    // Remove oldest entries (approximation since Sets don't guarantee order)
    const excess = state.observedPosts.size - CONFIG.MAX_PROCESSED_POSTS;
    const entries = Array.from(state.observedPosts).slice(0, excess);
    entries.forEach(entry => state.observedPosts.delete(entry));
    debugLog(`Pruned ${excess} old post IDs from observed set`);
  }
  
  // Extract post data
  const postData = extractPostData(postElement, postId);
  if (!postData) return;
  
  // Increment capture count
  state.captureCount++;
  
  // Send to background script with high priority
  chrome.runtime.sendMessage({
    type: 'capture',
    entry: {
      url: postData.url,
      title: postData.title,
      tags: ['reddit', postData.subreddit, 'viewport-captured'].filter(Boolean),
      timestamp: new Date().toISOString(),
      priority: 'high'  // Mark as high priority
    }
  });
  
  // Add visual indicator to the post
  addVisualIndicator(postElement);
  
  // Show status immediately
  chrome.runtime.sendMessage({
    type: 'showStatus',
    message: `Captured: ${postData.title.substring(0, 40)}...`,
    count: state.captureCount,
    immediate: true  // Request immediate display
  });
  
  debugLog('Captured post in viewport:', postData.title, postData.url);
}

/**
 * Add a small visual indicator to show the post has been captured
 */
function addVisualIndicator(postElement) {
  // Create indicator if it doesn't exist
  if (!postElement.querySelector('.archivebox-captured-indicator')) {
    const indicator = document.createElement('div');
    indicator.className = 'archivebox-captured-indicator';
    indicator.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      background: rgba(0, 128, 0, 0.6);
      color: white;
      font-size: 10px;
      padding: 2px 5px;
      border-radius: 0 0 0 3px;
      z-index: 9999;
    `;
    indicator.textContent = '✓ Archived';
    
    // Make sure the post has a relative position for absolute positioning to work
    if (getComputedStyle(postElement).position === 'static') {
      postElement.style.position = 'relative';
    }
    
    postElement.appendChild(indicator);
  }
}

/**
 * Set up intersection observer to detect posts as they become visible
 */
function setupObserver() {
  debugLog('Setting up viewport observer for Reddit');
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= CONFIG.OBSERVATION_THRESHOLD) {
        const postElement = entry.target;
        
        // Extract post ID to avoid processing the same post multiple times
        const postId = postElement.id || 
                       postElement.getAttribute('data-post-id') || 
                       postElement.getAttribute('data-fullname') || 
                       postElement.getAttribute('id');
        
        if (!postId) return;
        
        // Queue for processing in top-to-bottom order
        queuePostForCapture(postElement, postId);
      }
    });
  }, { 
    threshold: CONFIG.OBSERVATION_THRESHOLD,
    rootMargin: CONFIG.ROOT_MARGIN
  });
  
  // Find and observe posts
  function findAndObservePosts() {
    // Attempt to find posts using different selectors for different Reddit versions
    const postSelectors = [
      // Current "new" Reddit redesign
      'div[data-testid="post-container"]',
      '.Post', 
      '[data-test-id="post-content"]',
      
      // Old Reddit design
      '.thing[data-author]',
      
      // Mobile Reddit
      'article[data-testid="post"]',
      
      // Generic fallbacks that might work across versions
      '[data-click-id="body"]',
      '.scrollerItem'
    ];
    
    const postElements = document.querySelectorAll(postSelectors.join(', '));
    
    if (postElements.length > 0) {
      debugLog(`Found ${postElements.length} Reddit posts to observe`);
      postElements.forEach(post => observer.observe(post));
    }
  }
  
  // Initial find
  findAndObservePosts();
  
  // Set up mutation observer to detect new posts loaded during scrolling
  const mutationObserver = new MutationObserver((mutations) => {
    let shouldFindPosts = false;
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldFindPosts = true;
        break;
      }
    }
    
    if (shouldFindPosts) {
      // Wait a small amount of time for any post loading to complete
      // This helps reduce redundant processing during rapid DOM changes
      clearTimeout(state.mutationTimeout);
      state.mutationTimeout = setTimeout(findAndObservePosts, CONFIG.MUTATION_OBSERVER_DELAY);
    }
  });
  
  // Observe changes to the body and any feed containers
  const feedContainers = [
    document.body, 
    ...document.querySelectorAll('.ListingLayout-outerContainer, .browse-container, #siteTable')
  ];
  
  feedContainers.forEach(container => {
    if (container) {
      mutationObserver.observe(container, { childList: true, subtree: true });
    }
  });
  
  return {
    disconnect: () => {
      observer.disconnect();
      mutationObserver.disconnect();
      debugLog('Observers disconnected');
    }
  };
}

/**
 * Initialize the content script
 */
function initialize() {
  if (state.isInitialized) return;
  
  // Only run on Reddit domains
  if (!window.location.hostname.includes('reddit.com')) {
    return;
  }
  
  debugLog('Reddit page detected, checking if capture is enabled');
  
  // Check if capture is enabled in the extension settings
  chrome.runtime.sendMessage({ type: 'getEnableStatus' }, function(response) {
    if (response && response.enableScrollCapture) {
      debugLog('Reddit capture enabled, setting up viewport detection');
      state.isEnabled = true;
      state.observers = setupObserver();
    } else {
      debugLog('Reddit capture is disabled in settings');
      state.isEnabled = false;
    }
    
    state.isInitialized = true;
  });
  
  // Listen for status changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'captureStatusChanged') {
      if (message.enabled && !state.isEnabled) {
        // Capture was enabled
        debugLog('Capture was enabled, setting up observers');
        state.isEnabled = true;
        state.observers = setupObserver();
      } else if (!message.enabled && state.isEnabled) {
        // Capture was disabled
        debugLog('Capture was disabled, shutting down observers');
        state.isEnabled = false;
        if (state.observers) {
          state.observers.disconnect();
          state.observers = null;
        }
      }
    }
  });
}

// Handle initialization properly
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
