// background.js

import { addToArchiveBox, captureScreenshot, captureDom } from "./utils.js";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

async function getS3Config() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['s3config'], (result) => {
      resolve(result.s3config || {});
    });
  });
}

async function uploadToS3(fileName, data, contentType = "image/png") {
  try {
    const s3Config = await getS3Config();

    if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
      throw new Error("S3 configuration is incomplete");
    }

    const client = new S3Client({
        endpoint: s3Config.endpoint,
        credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
        },
        region: s3Config.region,
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
    });

    // Use custom headers for our requests
    client.middlewareStack.add(
        (next) =>
            async (args) => {
            const request = args.request;

            const headers = request.headers;
            delete headers["x-amz-checksum-crc32"];
            delete headers["x-amz-checksum-crc32c"];
            delete headers["x-amz-checksum-sha1"];
            delete headers["x-amz-checksum-sha256"];
            request.headers = headers;

            Object.entries(request.headers).forEach(
                ([key, value]) => {
                    if (!request.headers) {
                        request.headers = {};
                    }
                    (request.headers)[key] = value;
                }
            );

            return next(args);
        },
        { step: "build", name: "customHeaders" }
    );

    // Send to S3
    const command = new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: fileName,
        Body: data,
        ContentType: contentType,
    });

    try {
        await client.send(command);
        return `${s3Config.endpoint}/${s3Config.bucket}/${fileName}`;
    } catch (err) {
        console.error("Upload failed:", err);
        throw err;
    }
  } catch (err) {
    console.log("upload failed: ", err)
  }
}

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
    addToArchiveBox(message.body, sendResponse, sendResponse);
  }
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_screenshot') {
    (async ()=> {
      try {
        const {fileName, path} = await captureScreenshot();
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
        const {fileName, path} = await captureDom()
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
    if (message.type === 'testS3Credentials') {
      (async () => {
        // upload test file
        try {
          const fileName = `.connection_test_${Date.now()}.txt`;
          const randomContent = Math.random().toString(36).substring(2, 15);
          const testData = new TextEncoder().encode(randomContent);

          const s3Url = await uploadToS3(fileName, testData, 'text/plain');

          // verify test file matches
          try {
            const response = await fetch(s3Url);
            console.log("verification response", response);
            if (response.ok) {
              const responseText = await response.text();
              const testPassed = responseText === randomContent;
              sendResponse(testPassed ? 'success' : 'failure');
            } else {
              sendResponse('failure');
            }
          } catch (fetchError) {
            console.error('Error verifying S3 upload:', fetchError);
            // Even if verification fails, the upload might have succeeded
            sendResponse('success');
          }
        } catch (error) {
          console.error('S3 credential test failed:', error);
          sendResponse('failure');
        }
      })();
      return true;
    }
});

chrome.contextMenus.onClicked.addListener(onClickContextMenuSave);

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'save_to_archivebox_ctxmenu',
    title: 'Save to ArchiveBox',
  });
});

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
