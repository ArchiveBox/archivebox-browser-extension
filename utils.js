// Common utility functions

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

export async function addToArchiveBox(addCommandArgs, onComplete, onError) {
  console.log('i addToArchiveBox', addCommandArgs);
  try {
    const { archivebox_server_url, archivebox_api_key } = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['archivebox_server_url', 'archivebox_api_key', 'config_archiveBoxBaseUrl'], (vals) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve({archivebox_server_url: vals.archivebox_server_url || vals.config_archiveBoxBaseUrl, archivebox_api_key: vals.archivebox_api_key});
        }
      });
    });

    console.log('i addToArchiveBox server url', archivebox_server_url);
    if (archivebox_server_url) {
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
