// background.js

import { addToArchiveBox } from "./utils.js";

class Snapshot {
  constructor(url, tags, title, favIconUrl) {
    this.id = crypto.randomUUID();
    this.url = url;
    this.timestamp = new Date().toISOString();
    this.tags = tags;
    this.title = title;
    this.favicon = favIconUrl;
  }
}

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
    console.debug(`[Auto-Archive Debug] Checking URL: ${url}`);

    const { enable_auto_archive=false, match_urls=[], exclude_urls=[] } = await chrome.storage.local.get([
      'enable_auto_archive',
      'match_urls',
      'exclude_urls',
    ]);

    console.debug(`[Auto-Archive Debug] Settings: enable_auto_archive=${enable_auto_archive}, match_urls="${match_urls}", exclude_urls="${exclude_urls}"`);

    if (!enable_auto_archive || !match_urls || match_urls.trim() === '') {
      console.debug('[Auto-Archive Debug] Auto-archiving disabled or match pattern empty');
      return false;
    }

    const matchPattern = new RegExp(match_urls);
    const matches = matchPattern.test(url);
    console.debug(`[Auto-Archive Debug] URL match test: ${matches} (pattern: ${matchPattern})`);

    if (!matches) {
      return false;
    }

    if (exclude_urls.trim()) {
      try {
        const excludePattern = new RegExp(exclude_urls);
        const excluded = excludePattern.test(url);
        console.debug(`[Auto-Archive Debug] URL exclude test: ${excluded} (pattern: ${excludePattern})`);

        if (excluded) {
          return false;
        }
      } catch (error) {
        console.error('Invalid exclude pattern:', error);
      }
    }

    console.debug(`[Auto-Archive Debug] URL ${url} should be archived: TRUE`);
    return true;
  } catch (error) {
    console.error('Error checking auto-archive patterns:', error);
    return false;
  }
}

// Global reference to the listener so we can remove it properly
let tabUpdateListener = null;

async function setupAutoArchiving() {
  console.debug('[Auto-Archive Debug] Setting up auto-archiving...');
  const { enable_auto_archive } = await chrome.storage.local.get(['enable_auto_archive']);
  console.debug(`[Auto-Archive Debug] enable_auto_archive setting: ${enable_auto_archive}`);

  if (tabUpdateListener) {
    console.debug('[Auto-Archive Debug] Removing existing tab update listener');
    try {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      tabUpdateListener = null;
    } catch (error) {
      console.error('Error removing listener:', error);
    }
  }

  if (enable_auto_archive) {
    console.debug('[Auto-Archive Debug] Auto-archive is enabled, checking permissions');
    const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
    console.debug(`[Auto-Archive Debug] Has tabs permission: ${hasPermission}`);

    if (hasPermission) {
      tabUpdateListener = async (tabId, changeInfo, tab) => {
        console.debug(`[Auto-Archive Debug] Tab updated - tabId: ${tabId}, status: ${changeInfo.status}, url: ${tab?.url}`);

        // Only process when the page has completed loading
        if (changeInfo.status === 'complete' && tab.url) {
          console.debug(`[Auto-Archive Debug] Tab load complete, checking if URL should be archived: ${tab.url}`);

          const shouldArchive = await shouldAutoArchive(tab.url);
          console.debug(`[Auto-Archive Debug] shouldAutoArchive result: ${shouldArchive}`);

          if (shouldArchive) {
            console.log('Auto-archiving URL:', tab.url);

            const snapshot = new Snapshot(
              tab.url,
              ['auto-archived'],
              tab.title,
              tab.favIconUrl,
            );

            console.debug('[Auto-Archive Debug] Created new snapshot, saving to storage');
            const { snapshots = [] } = await chrome.storage.local.get('snapshots');
            snapshots.push(snapshot);
            await chrome.storage.local.set({ snapshots });
            console.debug('[Auto-Archive Debug] Snapshot saved to local storage');

            try {
              console.debug(`[Auto-Archive Debug] Calling addToArchiveBox with URL: ${snapshot.url}, tags: ${snapshot.tags.join(',')}`);
              await addToArchiveBox([snapshot.url], snapshot.tags.join(','));
              console.log(`Automatically archived ${snapshot.url}`);
            } catch (error) {
              console.error(`Failed to automatically archive ${snapshot.url}: ${error.message}`);
            }
          }
        }
      };

      console.debug('[Auto-Archive Debug] Adding tab update listener');
      chrome.tabs.onUpdated.addListener(tabUpdateListener);
      console.log('Auto-archiving enabled with tabs permission');
    } else {
      console.log('Tabs permission not granted, auto-archiving disabled');
      console.debug('[Auto-Archive Debug] No tabs permission, disabling auto-archive setting');
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
  const snapshot = new Snapshot(
    tab.url,
    [],
    tab.title,
    tab.favIconUrl,
  );

  // Save the snapshot first
  const { snapshots = [] } = await chrome.storage.local.get('snapshots');
  snapshots.push(snapshot);
  await chrome.storage.local.set({ snapshots });

  // Inject scripts - CSS now handled in popup.js
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'archivebox_add') {
    const args = JSON.parse(message.body);
    addToArchiveBox(args.urls, args.tags)
      .then(sendResponse({ok: true}))
      .catch((error) => {
          console.error(`Failed to archive ${args.urls}: ${error.message}`);
          sendResponse({ok: false, errorMessage: error.message});
        }
      );
    console.log(`Successfully archived ${args.urls}`);
  }
  return true;
});


chrome.contextMenus.onClicked.addListener(onClickContextMenuSave);

// A generic onclick callback function.
async function onClickContextMenuSave(item, tab) {
  const snapshot = new Snapshot(
    tab.url,
    [],
    tab.title,
    tab.favIconUrl,
  );

  // Save the snapshot first
  const { snapshots = [] } = await chrome.storage.local.get('snapshots');
  snapshots.push(snapshot);
  await chrome.storage.local.set({ snapshots });

  // Inject scripts - CSS now handled in popup.js
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});
