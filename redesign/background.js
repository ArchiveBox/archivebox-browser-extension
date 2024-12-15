// background.js

chrome.runtime.onMessage.addListener(async (message) => {
    const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    console.log('i ArchiveBox Collector showing options.html', options_url);
    if (message.action === 'openOptionsPage') {
      await chrome.tabs.create({ url: options_url });
    }
  });

chrome.action.onClicked.addListener(async (tab) => {
  const entry = {
    id: crypto.randomUUID(),
    url: tab.url,
    timestamp: new Date().toISOString(),
    tags: [],
    title: tab.title,
    favicon: tab.favIconUrl
  };
  
  // Save the entry first
  const { entries = [] } = await chrome.storage.local.get('entries');
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  
  // Inject scripts - CSS now handled in popup.js
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'archivebox_add') {
    const { archivebox_server_url, archivebox_api_key } = await chrome.storage.local.get([
        'archivebox_server_url',
        'archivebox_api_key'
    ]);
    const response = fetch(`${archivebox_server_url}/api/v1/cli/add`, {
      headers: new Headers({
        "x-archivebox-api-key": `${archivebox_api_key}`
      }),
      method: "post",
      credentials: "include",
      body: message.body
    })
    .then(response => sendResponse(response))
    .catch(error => sendResponse({error: error.message}));
    return true; // Required for async response
  }
});
