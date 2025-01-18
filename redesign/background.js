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
      chrome.storage.local.get([
          'archivebox_server_url',
          'archivebox_api_key'
      ], ({ archivebox_server_url, archivebox_api_key }) => {
        if (!archivebox_server_url || !archivebox_api_key) {
          sendResponse({ success: false, errorMessage: 'Server not configured'});
          return;
        }

        fetch(`${archivebox_server_url}/api/v1/cli/add`, {
          headers: {
            'x-archivebox-api-key': `${archivebox_api_key}`
          },
          method: 'post',
          credentials: 'include',
          body: message.body
        })
        .then(response => {
          if (response.status === 404) {
            const parsedBody = JSON.parse(message.body);
            const body = new FormData()

            body.append("url", parsedBody.urls.join("\n"));
            body.append("tag", parsedBody.tags);
            body.append("depth", parsedBody.depth);
            body.append("parser", "url_list");
            body.append("parser", parsedBody.parser);

            const result = fetch(`${archivebox_server_url}/add/`, {
              method: "post",
              credentials: "include",
              body: body
            }).then(response => {
              if (response.ok) {
                return {status: response.status, statusText: response.statusText}
              }
              throw new Error(`Request failed with status ${response.status}`)
            });
            return result;
          }
          return response.json();
        })
        .then(data => {
          sendResponse({ success: true, data: data });
        })
        .catch(error => {
          sendResponse({ success: false, errorMessage: error.message });
        });
      }
    );
  }
  return true;
});
