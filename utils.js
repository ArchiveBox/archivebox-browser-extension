// Common utility functions

// Helper to get server URL with fallback to legacy config name
export async function getArchiveBoxServerUrl() {
  const { archivebox_server_url } = await chrome.storage.local.get(['archivebox_server_url']);    // new ArchiveBox Extension v2.1.3 location
  const {config_archiveBoxBaseUrl} = await chrome.storage.sync.get(['config_archiveBoxBaseUrl']); // old ArchiveBox Exporter v1.3.1 location
  return archivebox_server_url || config_archiveBoxBaseUrl || '';
}

export function filterEntries(entries, filterText) {
  if (!filterText) return entries;
  
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

// Helper: Only process pages that are "real" (skip about:blank, chrome://newtab, etc.)
function isRealPage(url) {
    return url !== "about:blank" && !url.startsWith("chrome://newtab");
}

// Convert a data URL to a Uint8Array.
// function dataUrlToUint8Array(dataUrl) {
//     const base64 = dataUrl.split(",")[1];
//     const binary = atob(base64);
//     const array = new Uint8Array(binary.length);
//     for (let i = 0; i < binary.length; i++) {
//         array[i] = binary.charCodeAt(i);
//     }
//     return array;
// }

export async function captureScreenshot() {
    const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
    const tab = activeTabs[0];
    if (
        !tab.url ||
        !isRealPage(tab.url) ||
        tab.url.startsWith("chrome-extension://")
    ) {
        return;
    }

    // Capture the visible tab as a PNG data URL.
    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else {
            resolve(dataUrl);
        }
      });
    });

    try {
      const base64 = dataUrl.split(",")[1];
      const byteString = atob(base64);
      const arrayBuffer = new ArrayBuffer(byteString.length);
      const uint8Array = new Uint8Array(arrayBuffer);

      for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([uint8Array], { type: "image/png" });

      const root = await navigator.storage.getDirectory();

      const screenshotsDir = await root.getDirectoryHandle('screenshots', { create: true });

      const timestamp = Date.now();
      const fileName = `screenshot-${timestamp}.png`;

      const fileHandle = await screenshotsDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      console.log(`Screenshot saved to OPFS: /screenshots/${fileName}`);
      return { ok: true, fileName, path: `/screenshots/${fileName}` };
    } catch (error) {
      console.error("Failed to save screenshot to OPFS:", error);
      return { ok: false }
    }
}


export async function captureDom() {
  try {
    const activeTabs = await chrome.tabs.query({active: true, currentWindow: true})
    const tabId = activeTabs[0].id;

    // sends a message to the content script
    const captureResponse = await chrome.tabs.sendMessage( tabId, { type: 'capture_dom' } );

    const timestamp = Date.now();
    const fileName = `${timestamp}.html`;

    const blob = new Blob([captureResponse.domContent], { type: "text/html" });

    try {
      const root = await navigator.storage.getDirectory();

      const domDir = await root.getDirectoryHandle('dom', { create: true });

      const fileHandle = await domDir.getFileHandle(fileName, { create: true });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      console.log(`DOM content saved to OPFS: /dom/${fileName}`);
      return { ok: true, fileName, path: `/dom/${fileName}` };
    } catch (error) {
      console.error("Failed to save DOM to OPFS:", error);
      throw error;
    }
  } catch (error) {
    console.log("failed to capture dom:", error);
    return { ok: false }
  }
}
