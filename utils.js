// Common utility functions

export class Snapshot {
  constructor(url, tags = [], title = '', favIconUrl = null) {
    this.id = crypto.randomUUID();
    this.url = url;
    this.timestamp = new Date().toISOString();
    this.tags = tags;
    this.title = title;
    this.favIconUrl = favIconUrl;
  }
}

// Helper to get server URL with fallback to legacy config name
export async function getArchiveBoxServerUrl() {
  const { archivebox_server_url } = await chrome.storage.local.get(['archivebox_server_url']);    // new ArchiveBox Extension v2.1.3 location
  const {config_archiveBoxBaseUrl} = await chrome.storage.sync.get(['config_archiveBoxBaseUrl']); // old ArchiveBox Exporter v1.3.1 location
  return archivebox_server_url || config_archiveBoxBaseUrl || '';
}

export function filterSnapshots(snapshots, filterText) {
  if (!filterText) return snapshots;
  
  const searchTerms = filterText.toLowerCase().split(' ');
  return snapshots.filter(snapshot => {
    const searchableText = [
      snapshot.url,
      snapshot.title,
      snapshot.id,
      new Date(snapshot.timestamp).toISOString(),
      ...snapshot.tags
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

// Archive URLs on the configured ArchiveBox server instance.
export async function addToArchiveBox(urls, tags = [], depth = 0, update = false, update_all = false) {
  const formattedTags = tags.join(',');
  console.log(`i Adding urls ${urls} and tags ${formattedTags} to ArchiveBox`);

  const archivebox_server_url = await getArchiveBoxServerUrl();
  const { archivebox_api_key } = await chrome.storage.local.get(['archivebox_api_key']);

  if (!archivebox_server_url) {
    throw new Error(`Server not configured`);
  }
  console.log('i Server url', archivebox_server_url);

  // try ArchiveBox v0.8.0+ API endpoint first
  if (archivebox_api_key) {
    console.log('i Using v0.8.5 REST API');
    const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
      headers: {
        'x-archivebox-api-key': `${archivebox_api_key}`
      },
      method: 'post',
      credentials: 'include',
      body: JSON.stringify({ urls, formattedTags, depth, update, update_all })
    });

    if (response.ok) {
      console.log(`i Successfully added ${urls} to ArchiveBox using v0.8.5 REST API`);
      return
    } else {
      console.warn(`! Failed to add ${urls} to ArchiveBox using v0.8.5 REST API. HTTP ${response.status} ${response.statusText}. Falling back to legacy API.`);
    }
  }

  // Fall back to pre-v0.8.0 endpoint for backwards compatibility
  console.log(`i Using legacy /add POST method`);

  const body = new FormData();
  body.append("url", urls.join("\n"));
  body.append("tag", formattedTags);
  body.append("parser", "auto")
  body.append("depth", depth)

  const response = await fetch(`${archivebox_server_url}/add/`, {
    method: "post",
    credentials: "include",
    body: body
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

export function downloadCsv(snapshots) {
  const headers = ['id', 'timestamp', 'url', 'title', 'tags'];
  const csvRows = [
    headers.join(','),
    ...snapshots.map(snapshot => {
      return [
        snapshot.id,
        snapshot.timestamp,
        `"${snapshot.url}"`,
        `"${snapshot.title || ''}"`,
        `"${snapshot.tags.join(';')}"`,
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

export function downloadJson(snapshots) {
  const jsonContent = JSON.stringify(snapshots, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
