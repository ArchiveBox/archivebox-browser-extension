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
      const vals = chrome.storage.local.get([
        'archivebox_server_url',
        'archivebox_api_key'
      ]);

      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(vals);
      }
    });
    console.log('i addToArchiveBox', archivebox_server_url, addCommandArgs);

    if (!archivebox_server_url) {
      throw new Error('Server not configured.');
    }


    let response = undefined;
    // try ArchiveBox v0.8.0+ API endpoint first
    if (archivebox_api_key) {
      response = fetch(`${archivebox_server_url}/api/v1/cli/add`, {
        headers: {
          'x-archivebox-api-key': `${archivebox_api_key}`
        },
        method: 'post',
        credentials: 'include',
        body: addCommandArgs
      }).then(response => {
        console.log('i addToArchiveBox using v0.8.5 REST API succeeeded', response.status, response.statusText);
        onComplete({ok: response.ok, status: response.status, statusText: response.statusText});
      }).catch(error => {
        console.warn('! addToArchiveBox using v0.8.5 REST API failed... falling back to old /add POST method')
        // fall back to pre-v0.8.0 endpoint for backwards compatibility
        const body = new FormData();
        const urls = addCommandArgs && addCommandArgs.urls ? addCommandArgs.urls.join("\n") : "";
        const tags = addCommandArgs && addCommandArgs.tags ? addCommandArgs.tags : "";

        body.append("url", urls);
        body.append("tag", tags);
        body.append("only_new", "1");

        response = fetch(`${archivebox_server_url}/add/`, {
          method: "post",
          credentials: "include",
          body: body
        }).then(response => {
          console.log('i addToArchiveBox using old /add POST method succeeded', response.status, response.statusText);
          onComplete({ok: response.ok, status: response.status, statusText: response.statusText});
        }).catch(error => {
          console.error('! addToArchiveBox using old /add POST method failed', error.message);
          onError({ok: false, errorMessage: error.message});
        });
      });
    }
  } catch (e) {
    console.error('! addToArchiveBox failed', e.message);
    onError({ok: false, errorMessage: e.message});
  }
  // keep the message channel open
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
