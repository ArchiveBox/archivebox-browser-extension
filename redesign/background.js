// background.js

chrome.runtime.onMessage.addListener(async (message) => {
    const optionsUrl = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    console.log('i ArchiveBox Collector showing options.html', optionsUrl);
    if (message.action === 'openOptionsPage') {
      await chrome.tabs.create({ url: optionsUrl });
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
  const { entries = [] } = await chrome.storage.sync.get('entries');
  entries.push(entry);
  await chrome.storage.sync.set({ entries });
  
  // Inject the tag input popup
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['popup.css']
  });
  
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  });

});
