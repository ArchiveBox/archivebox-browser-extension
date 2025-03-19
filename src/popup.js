// popup.js

const IS_IN_POPUP = window.location.href.startsWith('chrome-extension://') && window.location.href.endsWith('/popup.html');
const IS_ON_WEBSITE = !window.location.href.startsWith('chrome-extension://');

window.popup_element = null;
window.hide_timer = null;

window.closePopup = function () {
  document.querySelector(".archive-box-iframe")?.remove();
  window.popup_element = null;
  console.log("close popup");
};

// Handle escape key when popup doesn't have focus
document.addEventListener('keydown', (e) => {
  if (e.key == 'Escape') {
    closePopup();
  }
});

async function getAllTags() {
  const { entries = [] } = await chrome.storage.local.get('entries');
  return [...new Set(entries.flatMap(entry => entry.tags))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

async function sendToArchiveBox(url, tags) {
  let status = "pending";
  let ok = false;

  try {
    console.log('i Sending to ArchiveBox', { url, tags });

    const addCommandArgs = JSON.stringify({
      urls: [url],
      tags: tags.join(','),
    });

    const addResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'archivebox_add',
        body: addCommandArgs
      }, (response) => {
        if (!response.ok) {
          reject(`${response.errorMessage}`);
        }
        resolve(response);
      });
    })

    ok = true;
    status = 'Saved to ArchiveBox Server'
  } catch (error) {
    console.log(`ArchiveBox request failed: ${error}`);
    ok = false;
    status = `Failed to archive: ${error}`
  }

  const status_div = popup_element.querySelector('small');
  status_div.innerHTML = `
    <span class="status-indicator ${ok ? 'success' : 'error'}"></span>
    ${status}
  `;
  return { ok: ok, status: status};
}

async function sendCaptureMessage(messageType, timestamp) {
  try {
    const captureResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: messageType, timestamp: timestamp,
      }, (response) => {
        if (!response.ok) {
          reject(`${response.errorMessage}`);
        }
        resolve(response);
      });
    })
    return captureResponse;
  } catch (error) {
    return {ok: false, errorMessage: `Failed to capture: ${String(error)}`}
  }
}

async function sendSaveToS3Message(path, contentType) {
  try {
    const s3Response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'save_to_s3',
        path,
        contentType,
      }, (response) => {
        if (!response.ok) {
          reject(`${response.errorMessage}`);
        }
        resolve(response);
      });
    })
    return s3Response;
  } catch (error) {
    return {ok: false, errorMessage: `Failed to save to S3: ${String(error)}`};
  }
}

window.getCurrentEntry = async function() {
  const { entries = [] } = await chrome.storage.local.get('entries');
  let current_entry = entries.find(entry => entry.url === window.location.href);
  
  if (!current_entry) {
    current_entry = {
      id: crypto.randomUUID(),
      url: String(window.location.href),
      timestamp: new Date().toISOString(),
      tags: [],
      title: document.title,
      notes: '',
    };
    entries.push(current_entry);
    await chrome.storage.local.set({ entries });  // Save immediately
  }
  current_entry.id = current_entry.id || crypto.randomUUID();
  current_entry.url = current_entry.url || window.location.href;
  current_entry.timestamp = current_entry.timestamp || new Date().toISOString();
  current_entry.tags = current_entry.tags || [];
  current_entry.title = current_entry.title || document.title;
  current_entry.notes = current_entry.notes || '';

  console.log('i Loaded current ArchiveBox snapshot', current_entry);
  return { current_entry, entries };  // Return both for atomic updates
}

window.getSuggestedTags = async function() {
  const { current_entry, entries } = await getCurrentEntry();
  // Get all unique tags sorted by recency, excluding current entry's tags
  return ['⭐️', ...new Set(
    [
      window.location.hostname.replace('www.', '').replace('.com', ''),
      ...entries
          .filter(entry => entry.url !== current_entry.url)  // Better way to exclude current
          .reverse()
          .flatMap(entry => entry.tags),
    ]
  )]
  .filter(tag => !current_entry.tags.includes(tag))
  .slice(0, 5);
}

window.updateSuggestions = async function() {
  // console.log('Getting tag suggestions');
  if (!popup_element) return
  const suggestions_div = popup_element.querySelector('.ARCHIVEBOX__tag-suggestions');
  const suggested_tags = await getSuggestedTags();
  // console.log('Got suggestions', suggested_tags);
  suggestions_div.innerHTML = suggested_tags.length 
    ? `${suggested_tags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge suggestion">${tag}</span>`)
        .join(' ')}`
    : '';
}

async function saveLocally(timestamp, messageType) {
  // Save locally
  const captureResponse = await sendCaptureMessage(messageType, timestamp);
  if (captureResponse.ok) {
    console.log(`i Saved ${captureResponse.fileName} to ${captureResponse.path}`);
    return captureResponse.path;
  } else {
    console.log(`Error: Failed to save ${messageType} locally: ${captureResponse.errorMessage}` );
  }
}

window.updateCurrentTags = async function() {
  if (!popup_element) return;
  const current_tags_div = popup_element.querySelector('.ARCHIVEBOX__current-tags');
  const status_div = popup_element.querySelector('small');
  const { current_entry } = await getCurrentEntry();

  current_tags_div.innerHTML = current_entry.tags.length 
    ? `${current_entry.tags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge current" data-tag="${tag}">${tag}</span>`)
        .join(' ')}`
    : '';

  // Add click handlers for removing tags
  current_tags_div.querySelectorAll('.ARCHIVEBOX__tag-badge.current').forEach(badge => {
    badge.addEventListener('click', async (e) => {
      if (e.target.classList.contains('current')) {
        const { current_entry, entries } = await getCurrentEntry();
        const tag_to_remove = e.target.dataset.tag;
        current_entry.tags = current_entry.tags.filter(tag => tag !== tag_to_remove);
        await chrome.storage.local.set({ entries });
        await updateCurrentTags();
        await updateSuggestions();
      }
    });
  });

  // sendToArchiveBox(current_entry.url, current_entry.tags);
}


window.createPopup = async function() {
  const { current_entry, entries } = await getCurrentEntry();

  // Take the screenshot before the popup appears, but don't wait until it has
  // been saved to S3
  const screenshotPath = await saveLocally(current_entry.timestamp, 'capture_screenshot');
  screenshotS3Promise = screenshotPath ? sendSaveToS3Message(screenshotPath, 'image/png') : undefined;

  const domPath = await saveLocally(current_entry.timestamp, 'capture_dom');
  const domS3Promise = domPath ? sendSaveToS3Message(domPath, 'text/html') : undefined;

  // Create iframe container
  document.querySelector('.archive-box-iframe')?.remove();
  const iframe = document.createElement('iframe');
  iframe.className = 'archive-box-iframe';
  
  // Set iframe styles for positioning
  Object.assign(iframe.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    background: 'transparent',
    borderRadius: '6px',
    border: '0px',
    margin: '0px',
    padding: '0px',
    transform: 'translateY(0px)',
    boxSizing: 'border-box',
    width: '550px', // Initial width
    height: '200px', // Initial height
    transition: 'height 0.2s ease-out', // Smooth height transitions
    display: 'block',
  });

  document.body.appendChild(iframe);

  // Function to resize iframe based on content
  function resizeIframe() {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const content = doc.querySelector('.archive-box-popup');
    if (content) {
      const height = content.offsetHeight;
      const dropdown = doc.querySelector('.ARCHIVEBOX__autocomplete-dropdown');
      const dropdownHeight = dropdown && dropdown.style.display !== 'none' ? dropdown.offsetHeight : 0;
      iframe.style.height = (height + dropdownHeight + 20) + 'px'; // Add padding
    }
  }

  // Create popup content inside iframe
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  
  // Add styles to iframe
  const style = doc.createElement('style');
  style.textContent = `
    html, body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 16px;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    
    .archive-box-popup {
      border-radius: 13px;
      min-height: 90px;
      background: #bf7070;
      margin: 0px;
      padding: 6px;
      padding-top: 8px;
      color: white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      font-family: system-ui, -apple-system, sans-serif;
      transition: all 0.2s ease-out;
    }
    
    .archive-box-popup:hover {
      animation: slideDown -0.3s ease-in-out forwards;
      opacity: 1;
    }
    
    .archive-box-popup small {
      display: block;
      width: 100%;
      text-align: center;
      margin-top: 5px;
      color: #fefefe;
      overflow: hidden;
      font-size: 11px;
      opacity: 1.0;
    }

    .archive-box-popup small.fade-out {
      animation: fadeOut 10s ease-in-out forwards;
    }
    
    .archive-box-popup img {
      width: 15%;
      max-width: 40px;
      display: inline-block;
      vertical-align: top;
    }
    
    .archive-box-popup .options-link {
      border: 1px solid #00000026;
      border-right: 0px;
      margin-right: -9px;
      margin-top: -1px;
      border-radius: 6px 0px 0px 6px;
      padding-right: 7px;
      padding-left: 3px;
      text-decoration: none;
      text-align: center;
      font-size: 24px;
      line-height: 1.4;
      display: inline-block;
      width: 34px;
      transition: text-shadow 0.1s ease-in-out;
    }
    .archive-box-popup a.options-link:hover {
      text-shadow: 0 0 10px #a1a1a1;
    }
    
    .archive-box-popup .metadata {
      display: inline-block;
      max-width: 80%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .archive-box-popup input {
      width: calc(100% - 42px);
      border: 0px;
      margin: 0px;
      padding: 5px;
      padding-left: 13px;
      border-radius: 6px;
      min-width: 100px;
      background-color: #fefefe;
      color: #1a1a1a;
      vertical-align: top;
      display: inline-block;
      line-height: 1.75 !important;
      margin-bottom: 8px;
    }
    
    @keyframes fadeOut {
      0% { opacity: 1; }
      80% { opacity: 0.8;}
      100% { opacity: 0; display: none; }
    }
    
    @keyframes slideDown {
      0% { top: -500px; }
      100% { top: 20px }
    }
    
    .ARCHIVEBOX__tag-suggestions {
      margin-top: 20px;
      display: inline;
      min-height: 0;
      background-color: rgba(0, 0, 0, 0);
      border: 0;
      box-shadow: 0 0 0 0;
    }
    .ARCHIVEBOX__current-tags {
      display: inline;
    }
    
    .current-tags {
      margin-top: 20px;
      display: inline;
    }
    
    .ARCHIVEBOX__tag-badge {
      display: inline-block;
      background: #e9ecef;
      padding: 3px 8px;
      border-radius: 3px;
      padding-left: 18px;
      margin: 2px;
      font-size: 15px;
      cursor: pointer;
      user-select: none;
    }
    
    .ARCHIVEBOX__tag-badge.suggestion {
      background: #007bff;
      color: white;
      opacity: 0.2;
    }
    .ARCHIVEBOX__tag-badge.suggestion:hover {
      opacity: 0.8;
    }
    .ARCHIVEBOX__tag-badge.suggestion:active {
      opacity: 1;
    }
    
    .ARCHIVEBOX__tag-badge.suggestion:after {
      content: ' +';
    }
    
    .ARCHIVEBOX__tag-badge.current {
      background: #007bff;
      color: #ddd;
      position: relative;
      padding-right: 20px;
    }
    
    .ARCHIVEBOX__tag-badge.current:hover::after {
      content: '×';
      position: absolute;
      right: 5px;
      top: 50%;
      transform: translateY(-50%);
      font-weight: bold;
      cursor: pointer;
    }
    
    .status-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 5px;
    }
    
    .status-indicator.success {
      background: #28a745;
    }
    
    .status-indicator.error {
      background: #dc3545;
    }

    .ARCHIVEBOX__autocomplete-dropdown {
      background: white;
      border: 1px solid #ddd;
      border-radius: 0 0 6px 6px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      max-height: 200px;
      overflow-y: auto;
      transition: all 0.2s ease-out;
    }
    
    .ARCHIVEBOX__autocomplete-item {
      padding: 8px 12px;
      cursor: pointer;
      color: #333;
    }
    
    .ARCHIVEBOX__autocomplete-item:hover,
    .ARCHIVEBOX__autocomplete-item.selected {
      background: #f0f0f0;
    }
  `;
  doc.head.appendChild(style);

  // Create popup content
  const popup = doc.createElement('div');
  popup.className = 'archive-box-popup';
  popup.innerHTML = `
    <a href="#" class="options-link" title="Open in ArchiveBox">🏛️</a> <input type="search" placeholder="Add tags + press ⏎   |   ⎋ to close">
    <br/>
    <div class="ARCHIVEBOX__current-tags"></div><div class="ARCHIVEBOX__tag-suggestions"></div><br/>
    <small class="fade-out">
      <span class="status-indicator"></span>
      Saved locally...
    </small>
  `;

  doc.body.appendChild(popup);
  window.popup_element = popup;

  // Add message passing for options link
  popup.querySelector('.options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptionsPage', id: current_entry.id });
  });

  const input = popup.querySelector('input');
  const suggestions_div = popup.querySelector('.ARCHIVEBOX__tag-suggestions');
  const current_tags_div = popup.querySelector('.ARCHIVEBOX__current-tags');
  
  // console.log('Getting current tags and suggestions');

  // Initial display of current tags and suggestions
  await window.updateCurrentTags();
  await window.updateSuggestions();
  
  // Add click handlers for suggestion badges
  suggestions_div.addEventListener('click', async (e) => {
    if (e.target.classList.contains('suggestion')) {
      const { current_entry, entries } = await getCurrentEntry();
      const tag = e.target.textContent.replace(' +', '');
      if (!current_entry.tags.includes(tag)) {
        current_entry.tags.push(tag);
        await chrome.storage.local.set({ entries });
        await updateCurrentTags();
        await updateSuggestions();
      }
    }
  });
  current_tags_div.addEventListener('click', async (e) => {
    if (e.target.classList.contains('current')) {
      const tag = e.target.dataset.tag;
      console.log('Removing tag', tag);
      const { current_entry, entries } = await getCurrentEntry();
      current_entry.tags = current_entry.tags.filter(t => t !== tag);
      await chrome.storage.local.set({ entries });
      await updateCurrentTags();
      await updateSuggestions();
    }
  });

  // Add dropdown container
  const dropdownContainer = document.createElement('div');
  dropdownContainer.className = 'ARCHIVEBOX__autocomplete-dropdown';
  dropdownContainer.style.display = 'none';
  input.parentNode.insertBefore(dropdownContainer, input.nextSibling);

  let selectedIndex = -1;
  let filteredTags = [];

  async function updateDropdown() {
    const inputValue = input.value.toLowerCase();
    const allTags = await getAllTags();
    
    // Filter tags that match input and aren't already used
    const { current_entry } = await getCurrentEntry();
    filteredTags = allTags
      .filter(tag => 
        tag.toLowerCase().includes(inputValue) && 
        !current_entry.tags.includes(tag) &&
        inputValue
      )
      .slice(0, 5);  // Limit to 5 suggestions

    if (filteredTags.length === 0) {
      dropdownContainer.style.display = 'none';
      selectedIndex = -1;
    } else {
      dropdownContainer.innerHTML = filteredTags
        .map((tag, index) => `
          <div class="ARCHIVEBOX__autocomplete-item ${index === selectedIndex ? 'selected' : ''}"
               data-tag="${tag}">
            ${tag}
          </div>
        `)
        .join('');
      
      dropdownContainer.style.display = 'block';
    }

    // Trigger resize after dropdown visibility changes
    setTimeout(resizeIframe, 0);
  }

  // Handle input changes
  input.addEventListener('input', updateDropdown);

  // Handle keyboard navigation

  // Handle escape key when popup has focus
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dropdownContainer.style.display = "none";
      selectedIndex = -1;
      closePopup();
      return;
    }

    if (!filteredTags.length) {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        const { current_entry, entries } = await getCurrentEntry();
        const newTag = input.value.trim();
        if (!current_entry.tags.includes(newTag)) {
          current_entry.tags.push(newTag);
          await chrome.storage.local.set({ entries });
          input.value = '';
          await updateCurrentTags();
          await updateSuggestions();
        }
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredTags.length - 1);
        updateDropdown();
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateDropdown();
        break;
      
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          const selectedTag = filteredTags[selectedIndex];
          const { current_entry, entries } = await getCurrentEntry();
          if (!current_entry.tags.includes(selectedTag)) {
            current_entry.tags.push(selectedTag);
            await chrome.storage.local.set({ entries });
          }
          input.value = '';
          dropdownContainer.style.display = 'none';
          selectedIndex = -1;
          await updateCurrentTags();
          await updateSuggestions();
        }
        break;
      
      case 'Tab':
        if (selectedIndex >= 0) {
          e.preventDefault();
          input.value = filteredTags[selectedIndex];
          dropdownContainer.style.display = 'none';
          selectedIndex = -1;
        }
        break;
    }
  });


  // Handle click selection
  dropdownContainer.addEventListener('click', async (e) => {
    const item = e.target.closest('.ARCHIVEBOX__autocomplete-item');
    if (item) {
      const selectedTag = item.dataset.tag;
      const { current_entry, entries } = await getCurrentEntry();
      if (!current_entry.tags.includes(selectedTag)) {
        current_entry.tags.push(selectedTag);
        await chrome.storage.local.set({ entries });
      }
      input.value = '';
      dropdownContainer.style.display = 'none';
      selectedIndex = -1;
      await updateCurrentTags();
      await updateSuggestions();
    }
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ARCHIVEBOX__autocomplete-dropdown') && 
        !e.target.closest('input')) {
      dropdownContainer.style.display = 'none';
      selectedIndex = -1;
    }
  });

  input.focus();
  console.log('+ Showed ArchiveBox popup in iframe');

  // Add resize triggers
  const resizeObserver = new ResizeObserver(() => {
    resizeIframe();
  });

  // Observe the popup content for size changes
  resizeObserver.observe(popup);

  const originalUpdateCurrentTags = window.updateCurrentTags;
  window.updateCurrentTags = async function() {
    await originalUpdateCurrentTags();
    resizeIframe();
  }

  async function updateDropdown() {
    const inputValue = input.value.toLowerCase();
    const allTags = await getAllTags();
    
    // Filter tags that match input and aren't already used
    const { current_entry } = await getCurrentEntry();
    filteredTags = allTags
      .filter(tag => 
        tag.toLowerCase().includes(inputValue) && 
        !current_entry.tags.includes(tag) &&
        inputValue
      )
      .slice(0, 5);  // Limit to 5 suggestions

    if (filteredTags.length === 0) {
      dropdownContainer.style.display = 'none';
      selectedIndex = -1;
    } else {
      dropdownContainer.innerHTML = filteredTags
        .map((tag, index) => `
          <div class="ARCHIVEBOX__autocomplete-item ${index === selectedIndex ? 'selected' : ''}"
               data-tag="${tag}">
            ${tag}
          </div>
        `)
        .join('');
      
      dropdownContainer.style.display = 'block';
    }

    // Trigger resize after dropdown visibility changes
    setTimeout(resizeIframe, 0);
  }

  // Initial resize
  setTimeout(resizeIframe, 0);

  // Update the current entry with the result of the S3 backups
  if (screenshotS3Promise) {
    const screenshotS3Response = await screenshotS3Promise;
    if (screenshotS3Response.ok) {
      console.log(`i Saved screenshot to S3 at ${screenshotS3Response.url}`);
      current_entry.s3ScreenshotURL = screenshotS3Response.url;
    } else {
      console.log(`Failed to backup to S3: ${screenshotS3Response.errorMessage}`);
    }
  }

  if (domS3Promise) {
    const domS3Response = await domS3Promise;
    if (domS3Response.ok) {
      console.log(`i Saved DOM to S3 at ${domS3Response.url}`);
      current_entry.s3domURL = domS3Response.url;
    } else {
      console.log(`Failed to backup to S3: ${domS3Response.errorMessage}`);
    }
  }

  await chrome.storage.local.set({ entries });
}

window.createPopup();
