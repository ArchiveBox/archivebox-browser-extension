// Common utility functions

// Helper to get server URL with fallback to legacy config name
export async function getArchiveBoxServerUrl() {
  const { archivebox_server_url } = await chrome.storage.local.get(['archivebox_server_url']);    // new ArchiveBox Extension v2.1.3 location
  const {config_archiveBoxBaseUrl} = await chrome.storage.sync.get(['config_archiveBoxBaseUrl']); // old ArchiveBox Exporter v1.3.1 location
  return archivebox_server_url || config_archiveBoxBaseUrl || '';
}

export function filterEntries(entries, filterText) {
  if (!filterText) return entries;
  
  // Handle site: prefix
  if (filterText.toLowerCase().startsWith('site:')) {
    const siteId = filterText.slice(5).toLowerCase().trim();
    const handlers = getAllHandlers();
    const handler = handlers[siteId];
    
    if (handler) {
      return entries.filter(entry => 
        handler.domains.some(domain => entry.url.includes(domain))
      );
    }
  }
  
  // Regular search
  const searchTerms = filterText.toLowerCase().split(' ');
  return entries.filter(entry => {
    const searchableText = [
      entry.url,
      entry.title,
      entry.id,
      new Date(entry.timestamp).toISOString(),
      ...entry.tags
    ].join(' ').toLowerCase();
    
    return searchTerms.every(term => searchableText.includes(term));
  });
}

// Common function to format cookies for export used in both personas-tab.js and cookies-tab.js
export function formatCookiesForExport(cookies) {
  return Object.entries(cookies).map(([domain, domainCookies]) => {
    return `# ${domain}\n${domainCookies.map(cookie => 
      `${cookie.name}=${cookie.value}; domain=${cookie.domain}; path=${cookie.path}`
    ).join('\n')}`;
  }).join('\n\n');
}

// Status indicator update helper
export function updateStatusIndicator(indicator, textElement, success, message) {
  indicator.className = success ? 'status-indicator status-success' : 'status-indicator status-error';
  textElement.textContent = message;
  textElement.className = success ? 'text-success' : 'text-danger';
}

export async function addToArchiveBox(addCommandArgs, onComplete, onError) {
  console.log('i addToArchiveBox', addCommandArgs);
  try {
    const archivebox_server_url = await getArchiveBoxServerUrl();
    const { archivebox_api_key } = await chrome.storage.local.get(['archivebox_api_key']);

    console.log('i addToArchiveBox server url', archivebox_server_url);
    if (!archivebox_server_url) {
      throw new Error('Server not configured.');
    }

    if (archivebox_api_key) {
      // try ArchiveBox v0.8.0+ API endpoint first
      try {
        const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
          headers: {
            'x-archivebox-api-key': `${archivebox_api_key}`
          },
          method: 'post',
          credentials: 'include',
          body: addCommandArgs
        });

        if (response.ok) {
          console.log('i addToArchiveBox using v0.8.5 REST API succeeded', response.status, response.statusText);
          onComplete({ok: response.ok, status: response.status, statusText: response.statusText});
          return true;
        } else {
          console.warn(`! addToArchiveBox using v0.8.5 REST API failed with status ${response.status} ${response.statusText}`);
          // Fall through to legacy API
        }
      } catch (error) {
        console.warn('! addToArchiveBox using v0.8.5 REST API failed with error:', error.message);
        // Fall through to legacy API
      }
    }

    // fall back to pre-v0.8.0 endpoint for backwards compatibility
    console.log('i addToArchiveBox using legacy /add POST method');

    const parsedAddCommandArgs = JSON.parse(addCommandArgs);
    const urls = parsedAddCommandArgs && parsedAddCommandArgs.urls
      ? parsedAddCommandArgs.urls.join("\n") : "";
    const tags = parsedAddCommandArgs && parsedAddCommandArgs.tags
      ? parsedAddCommandArgs.tags : "";

    const body = new FormData();
    body.append("url", urls);
    body.append("tag", tags);
    body.append("parser", "auto")
    body.append("depth", 0)

    try {
      const response = await fetch(`${archivebox_server_url}/add/`, {
        method: "post",
        credentials: "include",
        body: body
      });

      if (response.ok) {
        console.log('i addToArchiveBox using legacy /add POST method succeeded', response.status, response.statusText);
        onComplete({ok: response.ok, status: response.status, statusText: response.statusText});
      } else {
        console.error(`! addToArchiveBox using legacy /add POST method failed: ${response.status} ${response.statusText}`);
        onError({ok: false, errorMessage: `HTTP ${response.status}: ${response.statusText}`});
      }
    } catch (error) {
      console.error('! addToArchiveBox using legacy /add POST method failed with error:', error.message);
      onError({ok: false, errorMessage: error.message});
    }
  } catch (e) {
    console.error('! addToArchiveBox failed', e.message);
    onError({ok: false, errorMessage: e.message});
  }

  return true;
}

export function downloadCsv(entries) {
  const headers = ['id', 'timestamp', 'url', 'title', 'tags', 'notes'];
  const csvRows = [
    headers.join(','),
    ...entries.map(entry => {
      return [
        entry.id,
        entry.timestamp,
        `"${entry.url}"`,
        `"${entry.title || ''}"`,
        `"${entry.tags.join(';')}"`,
        `"${entry.notes || ''}"` 
      ].join(',');
    })
  ];

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadJson(entries) {
  const jsonContent = JSON.stringify(entries, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Shared syncToArchiveBox function for config-tab and entries-tab
export async function syncToArchiveBox(entry) {
  const archivebox_server_url = await getArchiveBoxServerUrl();
  const { archivebox_api_key } = await chrome.storage.local.get(['archivebox_api_key']);
  
  if (!archivebox_server_url || !archivebox_api_key) {
    return { 
      ok: false, 
      status: 'Server URL and API key must be configured and saved first' 
    };
  }

  try {
    const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-archivebox-api-key': archivebox_api_key,
      },
      body: JSON.stringify({
        urls: [entry.url],
        tag: entry.tags.join(','),
        depth: 0,
        update: false,
        update_all: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { 
        ok: false, 
        status: `Server returned ${response.status}: ${text}`
      };
    }

    return {
      ok: true,
      status: 'Success'
    };
  } catch (err) {
    return { 
      ok: false, 
      status: `Connection failed: ${err.message}` 
    };
  }
}

/**
 * Check if a URL should be captured automatically based on regex patterns
 * @param {string} url - The URL to check
 * @returns {boolean} - Whether the URL should be captured
 */
export async function shouldAutoCapture(url) {
  if (!url) return false;
  
  try {
    const { match_urls, exclude_urls } = await chrome.storage.local.get(['match_urls', 'exclude_urls']);
    
    // If no match pattern is defined, don't capture
    if (!match_urls) return false;
    
    // Create RegExp objects
    const matchPattern = new RegExp(match_urls);
    const excludePattern = exclude_urls ? new RegExp(exclude_urls) : null;
    
    // Check if URL matches the inclusion pattern and doesn't match the exclusion pattern
    if (matchPattern.test(url)) {
      return !excludePattern || !excludePattern.test(url);
    }
    
    return false;
  } catch (e) {
    console.error('Error checking if URL should be captured:', e);
    return false;
  }
}

/**
 * Get all available site handlers
 * @returns {Promise<Array>} - Array of site handler information
 */
export async function getAvailableSiteHandlers() {
  try {
    return await chrome.runtime.sendMessage({ type: 'getSiteHandlers' });
  } catch (e) {
    console.error('Error getting site handlers:', e);
    return [];
  }
}

/**
 * Get capture statistics
 * @returns {Promise<Object>} - Capture statistics by site
 */
export async function getCaptureStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStats' });
    return response?.stats || {};
  } catch (e) {
    console.error('Error getting capture stats:', e);
    return {};
  }
}

/**
 * Limit the size of a collection with a max size
 * @param {Array|Set} collection - The collection to limit
 * @param {number} maxSize - Maximum size allowed
 * @returns {Array|Set} - The limited collection
 */
export function limitCollectionSize(collection, maxSize) {
  if (!collection || typeof maxSize !== 'number' || maxSize <= 0) {
    return collection;
  }
  
  if (collection instanceof Set) {
    if (collection.size <= maxSize) return collection;
    
    const newSet = new Set();
    const entries = [...collection].slice(-maxSize); // Keep newest items (at the end)
    for (const entry of entries) {
      newSet.add(entry);
    }
    return newSet;
  }
  
  if (Array.isArray(collection)) {
    if (collection.length <= maxSize) return collection;
    return collection.slice(-maxSize); // Keep newest items (at the end)
  }
  
  return collection;
}

/**
 * Get current capture configuration
 * @returns {Promise<Object>} - Configuration object
 */
export async function getCaptureConfig() {
  return await chrome.storage.local.get([
    'enableScrollCapture',
    'scrollCaptureTags',
    'redditCaptureConfig'
  ]);
}

/**
 * Save capture configuration
 * @param {Object} config - Configuration to save
 * @returns {Promise<void>}
 */
export async function saveCaptureConfig(config) {
  await chrome.storage.local.set(config);
  
  // Notify tabs about configuration changes
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      chrome.tabs.sendMessage(tab.id, {
        type: 'captureConfigChanged',
        config
      }).catch(() => {/* Ignore errors for tabs that don't have content scripts */});
    } catch (e) {
      // Ignore errors for tabs that don't have content scripts
    }
  }
}
