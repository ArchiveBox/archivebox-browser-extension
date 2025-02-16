// Config tab initialization and handlers

export async function initializeConfigTab() {
  const configForm = document.getElementById('configForm');
  const serverUrl = document.getElementById('archivebox_server_url');
  const apiKey = document.getElementById('archivebox_api_key');
  const matchUrls = document.getElementById('match_urls');
  
  // Load saved values
  const savedConfig = await chrome.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key',
    'match_urls'
  ]);
  
  serverUrl.value = savedConfig.archivebox_server_url || '';
  apiKey.value = savedConfig.archivebox_api_key || '';
  matchUrls.value = savedConfig.match_urls || '.*';

  // Server test button handler
  document.getElementById('testServer').addEventListener('click', async () => {
    const statusIndicator = document.getElementById('serverStatus');
    const statusText = document.getElementById('serverStatusText');

    const updateStatus = (success, message) => {
      statusIndicator.className = success ? 'status-indicator status-success' : 'status-indicator status-error';
      statusText.textContent = message;
      statusText.className = success ? 'text-success' : 'text-danger';
    };

    try {
      let response = await fetch(`${serverUrl.value}/api/`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit'
      });
      
      // fall back to pre-v0.8.0 endpoint for backwards compatibility
      if (response.status === 404) {
        response = await fetch(`${serverUrl.value}`, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit'
        });
      }

      if (response.ok) {
        updateStatus(true, '✓ Server is reachable');
      } else {
        updateStatus(false, `✗ Server error: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      updateStatus(false, `✗ Connection failed: ${err.message}`);
    }
  });

  // API key test button handler
  document.getElementById('testApiKey').addEventListener('click', async () => {
    const statusIndicator = document.getElementById('apiKeyStatus');
    const statusText = document.getElementById('apiKeyStatusText');
    
    try {
      const response = await fetch(`${serverUrl.value}/api/v1/auth/check_api_token`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify({
          token: apiKey.value,
        })
      });
      const data = await response.json();
      
      if (data.user_id) {
        statusIndicator.className = 'status-indicator status-success';
        statusText.textContent = `✓ API key is valid: user_id = ${data.user_id}`;
        statusText.className = 'text-success';
      } else {
        statusIndicator.className = 'status-indicator status-error';
        statusText.textContent = `✗ API key error: ${response.status} ${response.statusText} ${JSON.stringify(data)}`;
        statusText.className = 'text-danger';
      }
    } catch (err) {
      statusIndicator.className = 'status-indicator status-error';
      statusText.textContent = `✗ API test failed: ${err.message}`;
      statusText.className = 'text-danger';
    }
  });

  // Generate API key button handler
  document.getElementById('generateApiKey').addEventListener('click', () => {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    apiKey.value = key;
  });

  // Login server button handler
  document.getElementById('loginServer').addEventListener('click', () => {
    if (serverUrl.value) {
      window.open(`${serverUrl.value}/admin`, '_blank');
    }
  });

  // Save changes when inputs change
  [serverUrl, apiKey, matchUrls].forEach(input => {
    input.addEventListener('change', async () => {
      await chrome.storage.local.set({
        archivebox_server_url: serverUrl.value,
        archivebox_api_key: apiKey.value,
        match_urls: matchUrls.value
      });
    });
  });

  // Test URL functionality
  const testUrlInput = document.getElementById('testUrl');
  const testButton = document.getElementById('testAdding');
  const testStatus = document.getElementById('testStatus');

  testButton.addEventListener('click', async () => {
    const url = testUrlInput.value.trim();
    if (!url) {
      testStatus.innerHTML = `
        <span class="status-indicator status-error"></span>
        Please enter a URL to test
      `;
      return;
    }

    // Show loading state
    testButton.disabled = true;
    testStatus.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Testing...
    `;

    try {
      const testEntry = {
        url,
        title: 'Test Entry',
        timestamp: new Date().toISOString(),
        tags: ['test']
      };

      const result = await syncToArchiveBox(testEntry);

      if (result.ok) {
        testStatus.innerHTML = `
          <span class="status-indicator status-success"></span>
          Success! URL was added to ArchiveBox
        `;
        // Clear the input on success
        testUrlInput.value = '';
      } else {
        testStatus.innerHTML = `
          <span class="status-indicator status-error"></span>
          Error: ${result.status}
        `;
      }
    } catch (error) {
      testStatus.innerHTML = `
        <span class="status-indicator status-error"></span>
        Error: ${error.message}
      `;
    } finally {
      testButton.disabled = false;
    }
  });

  // Add Enter key support for test URL input
  testUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      testButton.click();
    }
  });
}

async function syncToArchiveBox(entry) {
  const { archivebox_server_url, archivebox_api_key } = await chrome.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key'
  ]);

  if (!archivebox_server_url || !archivebox_api_key) {
    return { 
      ok: false, 
      status: 'Server URL and API key must be configured and saved first' 
    };
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

    if (!response.ok) {
      const text = await response.text();
      return { 
        ok: false, 
        status: `Server returned ${response.status}: ${text}`
      };
    }

    return {
      ok: true,
      status: 'Success'
    };
  } catch (err) {
    return { 
      ok: false, 
      status: `Connection failed: ${err.message}` 
    };
  }
}
