chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_dom') {
    try {
      const domContent = document.documentElement.outerHTML;
      sendResponse({domContent: domContent})
    } catch {
      console.log("failed to download", chrome.runtime.lastError);
      throw new Error(`failed to download: ${chrome.runtime.lastError}`);
    }
  }
});

