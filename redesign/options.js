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
  const { entries = [] } = await chrome.storage.sync.get('entries');
  
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
  const { entries = [] } = await chrome.storage.sync.get('entries');
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
  await chrome.storage.sync.set({ entries: remainingEntries });
  
  // Refresh the view
  await renderEntries(filterText);
}

// Add these functions near the top
async function loadConfig() {
  const config = await chrome.storage.sync.get([
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

      await chrome.storage.sync.set(config);
      
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
  const { archivebox_server_url, archivebox_api_key } = await chrome.storage.sync.get([
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
  const { entries = [] } = await chrome.storage.sync.get('entries');
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
  const { entries = [] } = await chrome.storage.sync.get('entries');
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
    const { entries = [] } = await chrome.storage.sync.get('entries');
    const filteredEntries = filterEntries(entries, filterInput.value);
    downloadCsv(filteredEntries);
  });

  downloadJsonBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    const { entries = [] } = await chrome.storage.sync.get('entries');
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

document.addEventListener('DOMContentLoaded', loadOptions);
