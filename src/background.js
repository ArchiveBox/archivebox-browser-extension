// background.js

import {
  addToArchiveBox,
  captureScreenshot,
  captureDom,
  uploadToS3,
  readFileFromOPFS,
} from "./utils.js";

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});


chrome.runtime.onMessage.addListener(async (message) => {
    const options_url = chrome.runtime.getURL('options.html') + `?search=${message.id}`;
    console.log('i ArchiveBox Collector showing options.html', options_url);
    if (message.action === 'openOptionsPage') {
      await chrome.tabs.create({ url: options_url });
    }
  });


// Listeners for user-submitted actions

async function saveEntry(tab) {
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

chrome.action.onClicked.addListener((tab, data) => saveEntry(tab));

chrome.contextMenus.onClicked.addListener((info, tab) => saveEntry(tab));

// Listeners for messages from other workers and contexts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'archivebox_add') {
    addToArchiveBox(message.body, sendResponse, sendResponse);
  }
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_screenshot') {
    (async ()=> {
      try {
        const {fileName, path} = await captureScreenshot(message.timestamp);
        sendResponse({ok: true, fileName, path});
      } catch (error) {
        console.log("failed to capture screenshot: ", error);
        sendResponse({ok: false});
      }
    })();
  }
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_dom') {
    (async ()=> {
      try {
        const {fileName, path} = await captureDom(message.timestamp)
        sendResponse({ok: true, fileName, path});
      } catch (error) {
        console.log("failed to capture dom: ", error);
        sendResponse({ok: false});
      }
    })();
  }
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'save_to_s3') {
    try {
      (async ()=> {
        const data = await readFileFromOPFS(message.path);

        if (!data) {
          throw new Error('Failed to read file from OPFS');
        }

        const fileName = message.path.split('/').filter(part=>part.length > 0).pop();
    
        console.log('filename: ', fileName);
        const s3Url = await uploadToS3(fileName, data, message.contentType);
        sendResponse({ok: true, url: s3Url});
      })();
    } catch (error) {
      console.log('Failed to upload to S3: ', error);
      sendResponse({ok: false});
    }
    return true;
  }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'test_s3') {
      (async () => {
        // Upload test file
        try {
          const fileName = `.connection_test_${Date.now()}.txt`;
          const randomContent = Math.random().toString(36).substring(2, 15);
          const testData = new TextEncoder().encode(randomContent);

          const s3Url = await uploadToS3(fileName, testData, 'text/plain');

          // Verify test file matches
          const response = await fetch(s3Url);

          if (response.ok) {
            const responseText = await response.text();
            const testPassed = responseText === randomContent;
            sendResponse(testPassed ? 'success' : 'failure');
          } else {
            console.error(`Failed to fetch test content: ${response.status} ${response,statusText}`);
            sendResponse('failure');
          }
        } catch (error) {
          console.error('S3 credential test failed:', error);
          sendResponse('failure');
        }
      })();
      return true;
    }
});


