import { Snapshot, addToArchiveBox } from "./utils.js";

// Checks if URL should be auto-archived based on regex patterns and configuration settings.
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

// Archives the specified tab. Meant to be used as a listener for tab updates.
async function autoArchive(tabId, changeInfo, tab) {
  console.debug(`[Auto-Archive Debug] Tab updated - tabId: ${tabId}, status: ${changeInfo.status}, url: ${tab?.url}`);

  // Only process when the page has completed loading
  if (changeInfo.status === 'complete' && tab.url) {
    console.debug(`[Auto-Archive Debug] Tab load complete, checking if URL should be archived: ${tab.url}`);

    // Check if URL is already archived locally
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const isAlreadyArchived = snapshots.some(s => s.url === tab.url);

    if (isAlreadyArchived) {
      console.debug(`[Auto-Archive Debug] URL already archived, skipping: ${tab.url}`);
      return;
    }

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
      snapshots.push(snapshot);
      await chrome.storage.local.set({ entries: snapshots });
      console.debug('[Auto-Archive Debug] Snapshot saved to local storage');

      try {
        console.debug(`[Auto-Archive Debug] Calling addToArchiveBox with URL: ${snapshot.url}, tags: ${snapshot.tags.join(',')}`);
        await addToArchiveBox([snapshot.url], snapshot.tags);
        console.log(`Automatically archived ${snapshot.url}`);
      } catch (error) {
        console.error(`Failed to automatically archive ${snapshot.url}: ${error.message}`);
      }
    }
  }
}

// Checks if we should be auto-archiving, and manages the listener accordingly. If the user has
// given the required permissions and enabled it through the UI, then we'll listen for tab updates
// and attempt to automatically archive the desired URLs.
async function configureAutoArchiving() {
  console.debug('[Auto-Archive Debug] Setting up auto-archiving...');

  const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
  console.debug(`[Auto-Archive Debug] Has tabs permission: ${hasPermission}`);

  if (!hasPermission) {
    console.log('Tabs permission not granted, auto-archiving disabled');
    return;
  }

  const { enable_auto_archive=false } = await chrome.storage.local.get(['enable_auto_archive']);
  console.debug(`[Auto-Archive Debug] enable_auto_archive setting: ${enable_auto_archive}`);

  const hasListener = chrome.tabs.onUpdated.hasListener(autoArchive)
  if (enable_auto_archive) {
    if (!hasListener) {
      chrome.tabs.onUpdated.addListener(autoArchive);
    }
    console.log('Auto-archiving enabled');
  } else {
    if (hasListener) {
      chrome.tabs.onUpdated.removeListener(autoArchive);
    }
    console.log('Auto-archiving disabled');
  }
}

// Initialize auto-archiving setup on extension load
chrome.runtime.onStartup.addListener(configureAutoArchiving);

// Listen for changes to the auto-archive setting
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enable_auto_archive) {
    configureAutoArchiving();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'archivebox_add':
      (async () => {
        try {
          const { urls = [], tags=[] } = message.body;
          await addToArchiveBox(urls, tags);
          console.log(`Successfully archived ${urls}`);
          sendResponse({ok: true});
        } catch (error) {
          console.error(`Failed send to ArchiveBox server: ${error.message}`);
          sendResponse({ok: false, errorMessage: error.message});
        }
      })();
      return true;

    case 'test_server_url':
      (async () => {
        try {
          const serverUrl = message.serverUrl;
          console.log("Testing server URL:", serverUrl);

          if (!serverUrl || !serverUrl.startsWith('http')) {
            sendResponse({ok: false, error: "Invalid server URL"});
            return;
          }

          const origin = new URL(serverUrl).origin;
          console.log("Server origin:", origin);

          // First try without credentials as Firefox is stricter
          try {
            console.log("Trying server API endpoint");
            let response = await fetch(`${serverUrl}/api/`, {
              method: 'GET',
              mode: 'cors'
            });

            if (response.ok) {
              console.log("API endpoint test successful");
              sendResponse({ok: true});
              return;
            }

            // Try the root URL for older ArchiveBox versions
            if (response.status === 404) {
              console.log("API endpoint not found, trying root URL");
              response = await fetch(`${serverUrl}`, {
                method: 'GET',
                mode: 'cors'
              });

              if (response.ok) {
                console.log("Root URL test successful");
                sendResponse({ok: true});
                return;
              }
            }

            console.log("Server returned non-OK response:", response.status, response.statusText);
            throw new Error(`${response.status} ${response.statusText}`);
          } catch (fetchError) {
            console.error("Fetch error:", fetchError);
            throw new Error(`NetworkError: ${fetchError.message}`);
          }
        } catch (error) {
          console.error("test_server_url failed:", error);
          sendResponse({ok: false, error: error.message});
        }
      })();
      return true;

    case 'test_api_key':
      (async () => {
        try {
          const { serverUrl, apiKey } = message;
          console.log("Testing API key for server:", serverUrl);

          if (!serverUrl || !serverUrl.startsWith('http')) {
            sendResponse({ok: false, error: "Invalid server URL"});
            return;
          }

          if (!apiKey) {
            sendResponse({ok: false, error: "API key is required"});
            return;
          }

          try {
            console.log("Attempting to verify API key...");
            const response = await fetch(`${serverUrl}/api/v1/auth/check_api_token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              mode: 'cors',
              body: JSON.stringify({
                token: apiKey,
              })
            });

            console.log("API key check response status:", response.status);

            if (response.ok) {
              const data = await response.json();
              console.log("API key check response data:", data);

              if (data.user_id) {
                sendResponse({ok: true, user_id: data.user_id});
              } else {
                sendResponse({ok: false, error: 'Invalid API key response'});
              }
            } else {
              sendResponse({ok: false, error: `${response.status} ${response.statusText}`});
            }
          } catch (fetchError) {
            console.error("API key check fetch error:", fetchError);
            sendResponse({ok: false, error: `NetworkError: ${fetchError.message}`});
          }
        } catch (error) {
          console.error("test_api_key failed:", error);
          sendResponse({ok: false, error: error.message});
        }
      })();
      return true;

    case 'open_options':
      (async () => {
        try {
          const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
          console.log('i ArchiveBox Collector showing options.html', options_url);
          await chrome.tabs.create({ url: options_url });
          sendResponse({ok: true});
        } catch (error) {
          console.error(`Failed to open options page: ${error.message}`);
          sendResponse({ok: false, error: error.message});
        }
      })();
      return true;

    default:
      console.error('Invalid message: ', message);
      return true;
  }
});

// Create context menus
chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});

// Context menu button
chrome.contextMenus.onClicked.addListener((item, tab) =>
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  })
);

// Toolbar button
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['popup.js']
  });
});
