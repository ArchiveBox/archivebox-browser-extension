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

export async function addToArchiveBox(addCommandArgs) {
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

    if (!archivebox_server_url) {
      throw new Error('Server not configured.');
    }

    let response = undefined;
    // try ArchiveBox v0.8.0+ API endpoint first
    if (archivebox_api_key) {
      response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
        headers: {
          'x-archivebox-api-key': `${archivebox_api_key}`
        },
        method: 'post',
        credentials: 'include',
        body: addCommandArgs
      });
    }

    // fall back to pre-v0.8.0 endpoint for backwards compatibility
    if (response === undefined || response.status === 404) {
      const parsedBody = JSON.parse(message.body);
      const body = new FormData();

      body.append("url", parsedBody.urls.join("\n"));
      body.append("tag", parsedBody.tags);

      response = await fetch(`${archivebox_server_url}/add/`, {
        method: "post",
        credentials: "include",
        body: body
      });
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return {ok: response.ok, status: response.status, statusText: response.statusText};
  } catch (e) {
    return {ok: false, errorMessage: e.message};
  }
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
