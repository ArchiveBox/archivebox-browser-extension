// background.js

import { addToArchiveBox, syncToArchiveBox } from "./utils.js";

chrome.runtime.onMessage.addListener(async (message) => {
    const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    console.log('i ArchiveBox Collector showing options.html', options_url);
    if (message.action === 'openOptionsPage') {
      await chrome.tabs.create({ url: options_url });
    }
  });

// Function to check if URL should be auto-archived based on regex patterns
async function shouldAutoArchive(url) {
  try {
    const { enable_auto_archive, match_urls, exclude_urls } = await chrome.storage.local.get([
      'enable_auto_archive',
      'match_urls',
      'exclude_urls',
    ]);

    if (!enable_auto_archive || !match_urls || match_urls.trim() === '') {
      return false;
    }

    const matchPattern = new RegExp(match_urls);

    if (!matchPattern.test(url)) {
      return false;
    }

    if (exclude_urls && exclude_urls.trim() !== '') {
      try {
        const excludePattern = new RegExp(exclude_urls);
        if (excludePattern.test(url)) {
          return false;
        }
      } catch (error) {
        console.error('Invalid exclude pattern:', error);
      }
    }

    return true;
  } catch (error) {
    console.error('Error checking auto-archive patterns:', error);
    return false;
  }
}

// Global reference to the listener so we can remove it properly
let tabUpdateListener = null;

async function setupAutoArchiving() {
  const { enable_auto_archive } = await chrome.storage.local.get(['enable_auto_archive']);

  if (tabUpdateListener) {
    try {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      tabUpdateListener = null;
    } catch (error) {
      console.error('Error removing listener:', error);
    }
  }

  if (enable_auto_archive) {
    const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });

    if (hasPermission) {
      tabUpdateListener = async (tabId, changeInfo, tab) => {
        // Only process when the page has completed loading
        if (changeInfo.status === 'complete' && tab.url) {
          if (await shouldAutoArchive(tab.url)) {
            console.log('Auto-archiving URL:', tab.url);

            const entry = {
              id: crypto.randomUUID(),
              url: tab.url,
              timestamp: new Date().toISOString(),
              tags: ['auto-archived'],
              title: tab.title,
              favicon: tab.favIconUrl
            };

            const { entries = [] } = await chrome.storage.local.get('entries');
            entries.push(entry);
            await chrome.storage.local.set({ entries });

            const result = await syncToArchiveBox(entry);
            console.log('Auto-archive result:', result);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(tabUpdateListener);
      console.log('Auto-archiving enabled with tabs permission');
    } else {
      console.log('Tabs permission not granted, auto-archiving disabled');
      // Reset the toggle if permission was not granted
      chrome.storage.local.set({ enable_auto_archive: false });
    }
  } else {
    console.log('Auto-archiving disabled');
  }
}

// Initialize auto-archiving setup on extension load
setupAutoArchiving();

// Listen for changes to the auto-archive setting
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enable_auto_archive) {
    setupAutoArchiving();
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
    addToArchiveBox(message.body, sendResponse, sendResponse);
  }
  return true;



chrome.contextMenus.onClicked.addListener(onClickContextMenuSave);

// A generic onclick callback function.
async function onClickContextMenuSave(item, tab) {
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
}
chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});
