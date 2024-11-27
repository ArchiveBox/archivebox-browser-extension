// options.js
// Add these functions at the top
function filterEntries(entries, filterText) {
  if (!filterText) return entries;
  
  const searchTerms = filterText.toLowerCase().split(' ');
  return entries.filter(entry => {
    const searchableText = [
      entry.url,
      entry.title,
      entry.id,
      new Date(entry.timestamp).toISOString(),
      ...entry.tags
    ].join(' ').toLowerCase();
    
    return searchTerms.every(term => searchableText.includes(term));
  });
}

async function renderEntries(filterText = '', tagFilter = '') {
  const { entries = [] } = await chrome.storage.local.get('entries');
  
  if (!window.location.search.includes(filterText)) {
    window.history.pushState({}, '', `?search=${filterText}`);
  }

  // Apply filters
  let filteredEntries = entries;
  if (tagFilter) {
    filteredEntries = entries.filter(entry => entry.tags.includes(tagFilter));
  }
  filteredEntries = filterEntries(filteredEntries, filterText);

  // Display filtered entries
  const entriesList = document.getElementById('entriesList');
  entriesList.innerHTML = filteredEntries.map(entry => `
    <div class="list-group-item">
      <div class="row">
        <small class="col-lg-2" style="display: block;min-width: 151px;text-align: center;">
          ${new Date(entry.timestamp).toISOString().replace('T', ' ').split('.')[0]}
        </small>
        <h5 class="col-lg-7">
          <a href="${entry.url}" target="_blank" name="${entry.id}" id="${entry.id}"><img src="${entry.favicon}" class="favicon"/><code>${entry.url}</code></a>
        </h5>
        <div class="col-lg-3">
          ${entry.tags.length ? `
            <p class="mb-1">
              ${entry.tags.map(tag => 
                `<span class="badge bg-secondary me-1 tag-filter" role="button" data-tag="${tag}">${tag}</span>`
              ).join('')}
            </p>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');

  // Add click handlers for tag filtering
  document.querySelectorAll('.tag-filter').forEach(tag => {
    tag.addEventListener('click', () => {
      const tagText = tag.dataset.tag;
      const filterInput = document.getElementById('filterInput');
      filterInput.value = tagText;
      renderEntries(tagText);
    });
  });
}

// Add this function near the top
function downloadCsv(entries) {
  // Define CSV headers and prep data
  const headers = ['id', 'timestamp', 'url', 'title', 'tags', 'notes'];
  const csvRows = [
    headers.join(','), // Header row
    ...entries.map(entry => {
      return [
        entry.id,
        entry.timestamp,
        `"${entry.url}"`,  // Wrap URL in quotes to handle commas
        `"${entry.title || ''}"`, // Handle titles with commas
        `"${entry.tags.join(';')}"`, // Join tags with semicolon
        `"${entry.notes || ''}"` // Handle notes with commas
      ].join(',');
    })
  ];

  // Create and trigger download
  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Add this function near downloadCsv
function downloadJson(entries) {
  const jsonContent = JSON.stringify(entries, null, 2); // Pretty print with 2 spaces
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Add this function near the other event handlers
async function handleDeleteFiltered(filterText = '') {
  const { entries = [] } = await chrome.storage.local.get('entries');
  const filteredEntries = filterEntries(entries, filterText);
  
  if (!filteredEntries.length) {
    alert('No entries to delete');
    return;
  }

  const message = filterText 
    ? `Delete ${filteredEntries.length} filtered entries?` 
    : `Delete all ${entries.length} entries?`;

  if (!confirm(message)) return;

  // Get IDs of entries to delete
  const idsToDelete = new Set(filteredEntries.map(e => e.id));
  
  // Keep only entries not in the filtered set
  const remainingEntries = entries.filter(e => !idsToDelete.has(e.id));
  
  // Save remaining entries
  await chrome.storage.local.set({ entries: remainingEntries });
  
  // Refresh the view
  await renderEntries(filterText);
}

// Add these functions near the top
async function loadConfig() {
  const config = await chrome.storage.local.get([
    'archivebox_server_url', 
    'archivebox_api_key',    // Added this
    'match_urls', 
    'exclude_urls'
  ]);
  
  document.getElementById('archivebox_server_url').value = config.archivebox_server_url || '';
  document.getElementById('archivebox_api_key').value = config.archivebox_api_key || '';  // Added this
  document.getElementById('match_urls').value = config.match_urls || '';
  document.getElementById('exclude_urls').value = config.exclude_urls || '';
}

function createAutosaveHandler() {
  let save_timeout;
  const status_div = document.createElement('div');
  status_div.style.display = 'none';
  status_div.style.color = '#666';
  status_div.style.fontSize = '0.9em';
  status_div.style.marginTop = '5px';
  document.querySelector('#config form').appendChild(status_div);

  return async function handleAutosave(e) {
    const input = e.target;
    testUrl();
    if (!input.checkValidity()) return;

    clearTimeout(save_timeout);
    
    // Show saving indicator after slight delay
    save_timeout = setTimeout(async () => {
      status_div.style.display = 'block';
      status_div.textContent = 'Saving...';

      const config = {
        archivebox_server_url: document.getElementById('archivebox_server_url').value,
        archivebox_api_key: document.getElementById('archivebox_api_key').value,
        match_urls: document.getElementById('match_urls').value || '',
        exclude_urls: document.getElementById('exclude_urls').value || ''
      };

      await chrome.storage.local.set(config);
      
      status_div.textContent = 'Saved.';
      setTimeout(() => {
        status_div.style.display = 'none';
      }, 4000);
    }, 500);
  };
}

async function testServer() {
  const serverUrl = document.getElementById('archivebox_server_url').value;
  const statusIndicator = document.getElementById('serverStatus');
  const statusText = document.getElementById('serverStatusText');
  
  try {
    const startTime = Date.now();
    const response = await fetch(`${serverUrl}/api/v1/docs`);
    const endTime = Date.now();
    
    statusIndicator.className = 'status-indicator ' + 
      (response.ok ? 'status-success' : 'status-error');
    const icon = response.ok ? '✅' : '❌';
    statusText.textContent = ` ${icon} ${response.status} ${response.statusText} (${endTime - startTime}ms)`;
    statusText.style.color = '#28a745';
  } catch (err) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = '❌ Connection failed';
  }
}

async function loginServer() {
  // redirect the user to ${archivebox_server_url}/admin/login/ in a new tab
  const archivebox_server_url = document.getElementById('archivebox_server_url').value;
  window.open(`${archivebox_server_url}/admin/login/`, '_blank');
}

function testUrl() {
  const url = document.getElementById('testUrl').value;
  const matchPattern = document.getElementById('match_urls').value;
  const excludePattern = document.getElementById('exclude_urls').value;
  
  const statusIndicator = document.getElementById('urlStatus');
  const statusText = document.getElementById('urlStatusText');
  
  try {
    const matchRegex = new RegExp(matchPattern);
    const excludeRegex = new RegExp(excludePattern);
    
    const isMatched = matchRegex.test(url);
    const isExcluded = excludeRegex.test(url);
    
    if (isExcluded) {
      statusIndicator.className = 'status-indicator status-error';
      statusText.textContent = '⛔️ URL would not be archived automatically because it matches an exclude pattern.';
    } else if (isMatched) {
      statusIndicator.className = 'status-indicator status-success';
      statusText.textContent = '✅ If visited in a tab, this URL would be archived automatically.';
    } else {
      statusIndicator.className = 'status-indicator status-error';
      statusText.textContent = '🟠 URL would not be archived automatically, but can by archived manually.';
    }
  } catch (err) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = `❌ Error ${err}`;
  }
}

// Add new function for API key generation
function generateApiKey() {
  const serverUrl = document.getElementById('archivebox_server_url').value;
  if (!serverUrl) {
    alert('Please enter ArchiveBox Server URL first');
    return;
  }
  window.open(`${serverUrl}/admin/api/apitoken/add/`, '_blank');
}

// Add new function near testServer()
async function testApiKey() {
  const serverUrl = document.getElementById('archivebox_server_url').value;
  const apiKey = document.getElementById('archivebox_api_key').value;
  const statusIndicator = document.getElementById('apiKeyStatus');
  const statusText = document.getElementById('apiKeyStatusText');
  
  if (!serverUrl || !apiKey) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = 'Server URL and API key required';
    return;
  }

  try {
    const startTime = Date.now();
    const response = await fetch(
      `${serverUrl}/api/v1/auth/check_api_token`,
      {
        method: 'POST', 
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: apiKey,
        }),
      },
    );
    const endTime = Date.now();
    // response json: {
    //   "success": false,
    //   "user_id": null
    // }
    const data = await response.json();
    // const successMsg = data.user_id ? 'valid' : 'invalid';
    // const userMsg = data.user_id ? `user ${data.user_id}` : 'no user';
    // const icon = data.user_id ? '✅' : '❌';
    // statusText.textContent = `${icon} API key ${successMsg} (${userMsg}) (${endTime - startTime}ms)`;
    if (data?.user_id) {
      statusText.textContent = `✅ API key valid (user ${data.user_id}) (${endTime - startTime}ms)`;
      statusText.style.color = '#28a745';
    } else {
      statusText.textContent = `❌ API key invalid (auth failed) (${endTime - startTime}ms)`;
      statusText.style.color = '#dc3545';
    }
    statusIndicator.className = 'status-indicator ' + 
      (data?.user_id ? 'status-success' : 'status-error');
    if (!data?.user_id) {
      statusText.style.color = '#dc3545';
    }
  } catch (err) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = '❌ API Connection failed';
  }
}

// Add this function near the other utility functions
async function syncToArchiveBox(entry) {
  const { archivebox_server_url, archivebox_api_key } = await chrome.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key'
  ]);

  if (!archivebox_server_url || !archivebox_api_key) {
    return { ok: false, status: 'Server not configured' };
  }

  try {
    const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: archivebox_api_key,
        urls: [entry.url],
        tag: entry.tags.join(','),
        depth: 0,
        update: false,
        update_all: false,
      }),
    });

    return {
      ok: response.ok,
      status: `${response.status} ${response.statusText}`
    };
  } catch (err) {
    return { ok: false, status: `Connection failed ${err}` };
  }
}

// Add this function to handle the sync operation
async function handleSync(filterText = '') {
  const { entries = [] } = await chrome.storage.local.get('entries');
  const filteredEntries = filterEntries(entries, filterText);
  
  if (!filteredEntries.length) {
    alert('No entries to sync');
    return;
  }

  const syncBtn = document.getElementById('syncFiltered');
  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Syncing...';

  // Process entries one at a time
  for (const entry of filteredEntries) {
    const row = document.getElementById(entry.id);
    if (!row) continue;

    // Add status indicator if it doesn't exist
    let statusIndicator = row.querySelector('.sync-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('span');
      statusIndicator.className = 'sync-status status-indicator';
      statusIndicator.style.marginLeft = '10px';
      row.querySelector('code').appendChild(statusIndicator);
    }

    // Update status to "in progress"
    statusIndicator.className = 'sync-status status-indicator';
    statusIndicator.style.backgroundColor = '#ffc107'; // yellow

    // Send to ArchiveBox
    const result = await syncToArchiveBox(entry);
    
    // Update status indicator
    statusIndicator.className = `sync-status status-indicator status-${result.ok ? 'success' : 'error'}`;
    statusIndicator.title = result.status;

    // Wait 1s before next request
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Reset button state
  syncBtn.disabled = false;
  syncBtn.textContent = 'SYNC';
}

// Add this function near testServer() and testApiKey()
async function testAdding() {
  const serverUrl = document.getElementById('archivebox_server_url').value;
  const apiKey = document.getElementById('archivebox_api_key').value;
  const testUrl = document.getElementById('testUrl').value;
  const statusIndicator = document.getElementById('addingStatus');
  const statusText = document.getElementById('addingStatusText');
  
  if (!serverUrl || !apiKey || !testUrl) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = 'Server URL, API key, and test URL required';
    return;
  }

  try {
    const startTime = Date.now();
    const response = await fetch(`${serverUrl}/api/v1/cli/add`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [testUrl],
        tag: 'test',
        depth: 0,
        update: false,
        update_all: false,
      }),
    });
    const endTime = Date.now();
    const data = await response.json();
    if (!data.success) {
      throw new Error(`❌ Adding failed: /api/v1/cli/add POST got ${response.status} ${response.statusText} (${endTime - startTime}ms)`);
    }
    statusIndicator.className = 'status-indicator status-success';
    statusText.textContent = ` ✅ Adding succeeded (${endTime - startTime}ms) <a href="${archivebox_server_url}/archive/${testUrl}" target="_blank">${testUrl}</a>`;
  } catch (err) {
    statusIndicator.className = 'status-indicator status-error';
    statusText.textContent = ` ${err}`;
  }
}

// Modify the loadOptions function to include config initialization
async function loadOptions() {
  // Initial render
  // get search query from url
  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get('search');
  await renderEntries(searchQuery);
  
  // Set up filter input handler
  const filterInput = document.getElementById('filterInput');
  let debounceTimeout;
  filterInput.value = filterInput.value || searchQuery;
  
  filterInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      renderEntries(e.target.value);
    }, 150); // Debounce for better performance
  });
  
  // Collect and display all unique tags
  const { entries = [] } = await chrome.storage.local.get('entries');
  const allTags = [...new Set(entries.flatMap(entry => entry.tags))];
  const tagsList = document.getElementById('tagsList');
  tagsList.innerHTML = allTags.map(tag => `
    <div class="list-group-item d-flex justify-content-between align-items-center tag-filter" role="button" data-tag="${tag}">
      ${tag}
      <span class="badge bg-primary rounded-pill">
        ${entries.filter(entry => entry.tags.includes(tag)).length}
      </span>
    </div>
  `).join('');

  // Add click handlers for sidebar tag filtering
  tagsList.querySelectorAll('.tag-filter').forEach(tagItem => {
    tagItem.addEventListener('click', () => {
      const tagText = tagItem.dataset.tag;
      const filterInput = document.getElementById('filterInput');
      filterInput.value = tagText;
      renderEntries(tagText);
    });
  });

  // Add download CSV handler
  const downloadBtn = document.getElementById('downloadCsv');
  const downloadJsonBtn = document.getElementById('downloadJson');
  
  downloadBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    const { entries = [] } = await chrome.storage.local.get('entries');
    const filteredEntries = filterEntries(entries, filterInput.value);
    downloadCsv(filteredEntries);
  });

  downloadJsonBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    const { entries = [] } = await chrome.storage.local.get('entries');
    const filteredEntries = filterEntries(entries, filterInput.value);
    downloadJson(filteredEntries);
  });

  // Add delete handler
  const deleteBtn = document.getElementById('deleteFiltered');
  deleteBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    await handleDeleteFiltered(filterInput.value);
  });

  // Initialize config tab
  await loadConfig();
  
  // Set up autosave for config inputs
  const autosaveHandler = createAutosaveHandler();
  ['archivebox_server_url', 'archivebox_api_key', 'match_urls', 'exclude_urls'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('input', autosaveHandler);
  });

  const filteredEntries = filterEntries(entries, window.location.search.split('=').at(-1));
  const url = document.getElementById('testUrl').value || filteredEntries.at(-1)?.url || '';
  document.getElementById('testUrl').value = url;

  // Add config form handlers
  document.getElementById('configForm').addEventListener('submit', autosaveHandler);
  document.getElementById('loginServer').addEventListener('click', loginServer);
  document.getElementById('testServer').addEventListener('click', testServer);
  document.getElementById('testUrl').addEventListener('input', testUrl);

  testServer();
  testApiKey();
  testUrl();
  // testAdding();
  
  // Add validation for regex inputs
  ['match_urls', 'exclude_urls'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('input', () => {
      try {
        if (input.value) {
          new RegExp(input.value);
        }
        input.setCustomValidity('');
      } catch {
        input.setCustomValidity('Invalid regex pattern');
      }
    });
  });

  // Add server url live validation
  const serverUrlInput = document.getElementById('archivebox_server_url');
  serverUrlInput.addEventListener('input', () => {
    const value = serverUrlInput.value;
    const isValid = /^https?:\/\//.test(value);
    if (!isValid) {
      serverUrlInput.setCustomValidity('Must be in the format https://hostname[:port] (just scheme + host + port, no path)');
    } else {
      serverUrlInput.setCustomValidity('');
      // click the test server button
      document.getElementById('testServer').click();
    }
  });

  // Add API key validation
  const apiKeyInput = document.getElementById('archivebox_api_key');
  const apiKeyValidation = document.getElementById('apiKeyStatusText');
  
  apiKeyInput.addEventListener('input', () => {
    const value = apiKeyInput.value;
    const isValid = /^[a-f0-9]{32}$/.test(value);
    
    if (!value) {
      apiKeyInput.setCustomValidity('');
      apiKeyValidation.textContent = '';
    } else if (!isValid) {
      apiKeyInput.setCustomValidity('Must be a 32 character lowercase hex string');
      apiKeyValidation.textContent = '❌ Invalid API token (expecting 32 char hex secret)';
      apiKeyValidation.style.color = '#dc3545';
    } else {
      apiKeyInput.setCustomValidity('');
      apiKeyValidation.textContent = '✅ Valid API token';
      apiKeyValidation.style.color = '#28a745';
      // click the test key button
      document.getElementById('testApiKey').click();
    }
  });

  // Add generate button handler
  document.getElementById('generateApiKey').addEventListener('click', generateApiKey);

  // Add to loadOptions() near the other event listeners
  document.getElementById('testApiKey').addEventListener('click', testApiKey);

  // Add sync handler
  const syncBtn = document.getElementById('syncFiltered');
  syncBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    await handleSync(filterInput.value);
  });

  // Add test adding button handler
  document.getElementById('testAdding').addEventListener('click', testAdding);
}

// Import functionality
let importItems = [];
let existingUrls = new Set();

async function initializeImport() {
  const { entries = [] } = await chrome.storage.local.get('entries');
  existingUrls = new Set(entries.map(e => e.url));
  
  // Set default dates for history
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // Default to last 24 hours
  
  document.getElementById('historyStartDate').valueAsDate = startDate;
  document.getElementById('historyEndDate').valueAsDate = endDate;
  
  // Add event listeners
  document.getElementById('loadHistory').addEventListener('click', loadHistory);
  document.getElementById('loadBookmarks').addEventListener('click', loadBookmarks);
  document.getElementById('importFilter').addEventListener('input', filterImportItems);
  document.getElementById('showNewOnly').addEventListener('change', filterImportItems);
  document.getElementById('selectAll').addEventListener('click', () => toggleAllSelection(true));
  document.getElementById('deselectAll').addEventListener('click', () => toggleAllSelection(false));
  document.getElementById('selectAllHeader').addEventListener('change', e => toggleAllSelection(e.target.checked));
  document.getElementById('importSelected').addEventListener('click', importSelected);
}

async function loadHistory() {
  const startDate = new Date(document.getElementById('historyStartDate').value);
  const endDate = new Date(document.getElementById('historyEndDate').value);
  endDate.setHours(23, 59, 59, 999);
  
  if (startDate > endDate) {
    alert('Start date must be before end date');
    return;
  }
  
  const maxResults = 10000;
  const historyItems = await chrome.history.search({
    text: '',
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
    maxResults
  });
  
  importItems = historyItems.map(item => ({
    url: item.url,
    title: item.title || '',
    timestamp: new Date(item.lastVisitTime).toISOString(),
    selected: false,
    isNew: !existingUrls.has(item.url)
  }));
  
  renderImportItems();
}

async function loadBookmarks() {
  function processBookmarkTree(nodes) {
    let items = [];
    for (const node of nodes) {
      if (node.url) {
        items.push({
          url: node.url,
          title: node.title || '',
          timestamp: new Date().toISOString(), // Bookmarks API doesn't provide add date
          selected: false,
          isNew: !existingUrls.has(node.url)
        });
      }
      if (node.children) {
        items = items.concat(processBookmarkTree(node.children));
      }
    }
    return items;
  }
  
  const tree = await chrome.bookmarks.getTree();
  importItems = processBookmarkTree(tree);
  renderImportItems();
}

function filterImportItems() {
  const filterText = document.getElementById('importFilter').value.toLowerCase();
  const showNewOnly = document.getElementById('showNewOnly').checked;
  
  const tbody = document.getElementById('importTable').querySelector('tbody');
  let visibleCount = 0;
  
  tbody.querySelectorAll('tr').forEach(row => {
    const url = row.querySelector('td:nth-child(2)').textContent;
    const title = row.querySelector('td:nth-child(3)').textContent;
    const isNew = !existingUrls.has(url);
    
    const matchesFilter = (url + ' ' + title).toLowerCase().includes(filterText);
    const matchesNewOnly = !showNewOnly || isNew;
    
    if (matchesFilter && matchesNewOnly) {
      row.style.display = '';
      visibleCount++;
    } else {
      row.style.display = 'none';
    }
  });
  
  updateSelectedCount();
}

function toggleAllSelection(selected) {
  const tbody = document.getElementById('importTable').querySelector('tbody');
  tbody.querySelectorAll('tr').forEach(row => {
    if (row.style.display !== 'none') {
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = selected;
      const index = parseInt(row.dataset.index);
      importItems[index].selected = selected;
    }
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  const visibleSelected = Array.from(document.getElementById('importTable').querySelectorAll('tbody tr'))
    .filter(row => row.style.display !== 'none' && row.querySelector('input[type="checkbox"]').checked)
    .length;
  document.getElementById('selectedCount').textContent = visibleSelected;
}

function renderImportItems() {
  const tbody = document.getElementById('importTable').querySelector('tbody');
  tbody.innerHTML = importItems.map((item, index) => `
    <tr data-index="${index}" class="${item.isNew ? '' : 'text-muted'}">
      <td>
        <input type="checkbox" class="form-check-input" 
               ${item.selected ? 'checked' : ''} 
               ${item.isNew ? '' : 'disabled'}>
      </td>
      <td><code>${item.url}</code></td>
      <td>${item.title}</td>
      <td>${new Date(item.timestamp).toLocaleString()}</td>
    </tr>
  `).join('');
  
  // Add event listeners for checkboxes
  tbody.querySelectorAll('input[type="checkbox"]').forEach((checkbox, index) => {
    checkbox.addEventListener('change', e => {
      importItems[index].selected = e.target.checked;
      updateSelectedCount();
    });
  });
  
  filterImportItems();
}

async function importSelected() {
  const selectedItems = importItems.filter(item => item.selected);
  if (!selectedItems.length) {
    alert('No items selected');
    return;
  }
  
  const tags = document.getElementById('importTags').value
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag);
  
  const { entries = [] } = await chrome.storage.local.get('entries');
  
  const newEntries = selectedItems.map(item => ({
    id: crypto.randomUUID(),
    url: item.url,
    title: item.title,
    timestamp: new Date().toISOString(),
    tags: [...tags],
    notes: ''
  }));
  
  entries.push(...newEntries);
  await chrome.storage.local.set({ entries });
  
  // Update existingUrls
  newEntries.forEach(entry => existingUrls.add(entry.url));
  
  // Clear selections and re-render
  importItems.forEach(item => item.selected = false);
  renderImportItems();
  
  // Clear tags input
  document.getElementById('importTags').value = '';
  
  // Show success message
  alert(`Successfully imported ${newEntries.length} items`);
}

// Initialize import functionality when options page loads
document.addEventListener('DOMContentLoaded', () => {
  // ... existing DOMContentLoaded handlers ...
  initializeImport();
});

document.addEventListener('DOMContentLoaded', loadOptions);

// Persona Management
let currentPersonas = [];
let availableCookies = [];
let selectedCookieDomains = new Set();

async function loadPersonas() {
  const { personas = [], activePersona = '' } = await chrome.storage.local.get(['personas', 'activePersona']);
  currentPersonas = personas;
  
  // Update persona selector
  const select = document.getElementById('activePersona');
  select.innerHTML = `
    <option value="">Select a persona...</option>
    ${personas.map(p => `
      <option value="${p.id}" ${p.id === activePersona ? 'selected' : ''}>
        ${p.name}
      </option>
    `).join('')}
  `;
  
  // Update persona table
  const tbody = document.getElementById('personaTable').querySelector('tbody');
  tbody.innerHTML = personas.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${Object.keys(p.cookies || {}).length} domains</td>
      <td>${p.lastUsed ? new Date(p.lastUsed).toLocaleString() : 'Never'}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary export-cookies" data-id="${p.id}">
          Export Cookies
        </button>
        <button class="btn btn-sm btn-outline-danger delete-persona" data-id="${p.id}">
          Delete
        </button>
      </td>
    </tr>
  `).join('');
  
  // Update stats for active persona
  updatePersonaStats(activePersona);
  
  // Update import button state
  document.getElementById('importCookies').disabled = !activePersona;
}

async function updatePersonaStats(personaId) {
  const stats = document.getElementById('personaStats');
  if (!personaId) {
    stats.textContent = 'No active persona selected';
    return;
  }
  
  const persona = currentPersonas.find(p => p.id === personaId);
  if (!persona) return;
  
  const domainCount = Object.keys(persona.cookies || {}).length;
  const cookieCount = Object.values(persona.cookies || {}).reduce((sum, cookies) => sum + cookies.length, 0);
  
  stats.textContent = `${persona.name}: ${domainCount} domains, ${cookieCount} cookies total`;
}

async function createNewPersona() {
  const name = prompt('Enter name for new persona:');
  if (!name) return;
  
  const persona = {
    id: crypto.randomUUID(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    cookies: {}
  };
  
  currentPersonas.push(persona);
  await chrome.storage.local.set({ personas: currentPersonas });
  await loadPersonas();
}

async function deletePersona(id) {
  if (!confirm('Delete this persona? This cannot be undone.')) return;
  
  currentPersonas = currentPersonas.filter(p => p.id !== id);
  const { activePersona } = await chrome.storage.local.get('activePersona');
  
  if (activePersona === id) {
    await chrome.storage.local.set({ activePersona: '' });
  }
  
  await chrome.storage.local.set({ personas: currentPersonas });
  await loadPersonas();
}

async function setActivePersona(id) {
  await chrome.storage.local.set({ activePersona: id });
  document.getElementById('importCookies').disabled = !id;
  await loadPersonas();
}

function formatCookiesForExport(cookies) {
  return Object.entries(cookies).map(([domain, domainCookies]) => {
    return `# ${domain}\n${domainCookies.map(cookie => 
      `${cookie.name}=${cookie.value}; domain=${cookie.domain}; path=${cookie.path}`
    ).join('\n')}`;
  }).join('\n\n');
}

async function exportPersonaCookies(id) {
  const persona = currentPersonas.find(p => p.id === id);
  if (!persona) return;
  
  const text = formatCookiesForExport(persona.cookies);
  await navigator.clipboard.writeText(text);
  alert('Cookies copied to clipboard!');
}

// Cookie Management
async function loadAvailableCookies() {
  const allCookies = await chrome.cookies.getAll({});
  
  // Group cookies by domain
  const cookiesByDomain = {};
  for (const cookie of allCookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    cookiesByDomain[domain] = cookiesByDomain[domain] || [];
    cookiesByDomain[domain].push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate
    });
  }
  
  availableCookies = Object.entries(cookiesByDomain).map(([domain, cookies]) => ({
    domain,
    cookies,
    selected: selectedCookieDomains.has(domain)
  }));
  
  renderCookieTable();
}

function renderCookieTable(filterText = '') {
  const tbody = document.getElementById('cookieTable').querySelector('tbody');
  const filteredCookies = availableCookies.filter(item => 
    item.domain.toLowerCase().includes(filterText.toLowerCase())
  );
  
  tbody.innerHTML = filteredCookies.map(item => `
    <tr>
      <td>
        <input type="checkbox" class="form-check-input cookie-select" 
               data-domain="${item.domain}" ${item.selected ? 'checked' : ''}>
      </td>
      <td>${item.domain}</td>
      <td>${item.cookies.length}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary preview-cookies" 
                data-domain="${item.domain}">
          Preview
        </button>
      </td>
    </tr>
  `).join('');
  
  updateSelectedCount();
}

function updateSelectedCount() {
  const count = selectedCookieDomains.size;
  document.getElementById('selectedCookieCount').textContent = count;
  document.getElementById('importCookies').disabled = count === 0 || !document.getElementById('activePersona').value;
}

function toggleAllCookieSelection(selected) {
  const filterText = document.getElementById('cookieFilter').value.toLowerCase();
  
  availableCookies.forEach(item => {
    // Only toggle selection if the item matches the current filter
    if (item.domain.toLowerCase().includes(filterText)) {
      if (selected) {
        selectedCookieDomains.add(item.domain);
        item.selected = true;
      } else {
        selectedCookieDomains.delete(item.domain);
        item.selected = false;
      }
    }
  });
  
  renderCookieTable(filterText);
}

async function previewCookies(domain) {
  const cookies = availableCookies.find(item => item.domain === domain)?.cookies || [];
  const text = formatCookiesForExport({ [domain]: cookies });
  alert(text);
}

async function importSelectedCookies() {
  const { activePersona } = await chrome.storage.local.get('activePersona');
  if (!activePersona) {
    alert('Please select an active persona first');
    return;
  }
  
  const persona = currentPersonas.find(p => p.id === activePersona);
  if (!persona) {
    alert('Selected persona not found');
    return;
  }
  
  // Initialize cookies object if it doesn't exist
  persona.cookies = persona.cookies || {};
  
  // Import selected cookies
  let importCount = 0;
  for (const item of availableCookies) {
    if (selectedCookieDomains.has(item.domain)) {
      persona.cookies[item.domain] = item.cookies;
      importCount++;
    }
  }
  
  persona.lastUsed = new Date().toISOString();
  
  // Save updated personas
  await chrome.storage.local.set({ personas: currentPersonas });
  
  // Clear selection
  selectedCookieDomains.clear();
  availableCookies.forEach(item => item.selected = false);
  
  // Refresh UI
  await loadPersonas();
  renderCookieTable(document.getElementById('cookieFilter').value);
  
  alert(`Successfully imported cookies from ${importCount} domains to "${persona.name}"`);
}

// Initialize Personas tab
document.addEventListener('DOMContentLoaded', () => {
  // Persona management
  document.getElementById('newPersona').addEventListener('click', createNewPersona);
  document.getElementById('activePersona').addEventListener('change', e => setActivePersona(e.target.value));
  
  document.getElementById('personaTable').addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button) return;
    
    const id = button.dataset.id;
    if (button.classList.contains('export-cookies')) {
      await exportPersonaCookies(id);
    } else if (button.classList.contains('delete-persona')) {
      await deletePersona(id);
    }
  });
  
  // Cookie management
  document.getElementById('cookieFilter').addEventListener('input', e => 
    renderCookieTable(e.target.value)
  );
  
  ['selectAllCookies', 'selectAllCookiesBottom'].forEach(id => 
    document.getElementById(id).addEventListener('click', () => toggleAllCookieSelection(true))
  );
  
  ['deselectAllCookies', 'deselectAllCookiesBottom'].forEach(id => 
    document.getElementById(id).addEventListener('click', () => toggleAllCookieSelection(false))
  );
  
  document.getElementById('cookieTable').addEventListener('click', async e => {
    const checkbox = e.target.closest('.cookie-select');
    if (checkbox) {
      const domain = checkbox.dataset.domain;
      const item = availableCookies.find(i => i.domain === domain);
      if (item) {
        item.selected = checkbox.checked;
        if (checkbox.checked) {
          selectedCookieDomains.add(domain);
        } else {
          selectedCookieDomains.delete(domain);
        }
        updateSelectedCount();
      }
      return;
    }
    
    const previewButton = e.target.closest('.preview-cookies');
    if (previewButton) {
      await previewCookies(previewButton.dataset.domain);
    }
  });
  
  document.getElementById('importCookies').addEventListener('click', importSelectedCookies);
  
  // Load initial data
  loadPersonas();
  loadAvailableCookies();
});
