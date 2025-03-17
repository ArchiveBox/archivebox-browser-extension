// Config tab initialization and handlers
import { updateStatusIndicator, syncToArchiveBox, getArchiveBoxServerUrl } from './utils.js';

export async function initializeConfigTab() {
  const configForm = document.getElementById('configForm');
  const serverUrl = document.getElementById('archivebox_server_url');
  const apiKey = document.getElementById('archivebox_api_key');
  const matchUrls = document.getElementById('match_urls');
  
  // Load saved values
  const archivebox_server_url = await getArchiveBoxServerUrl();
  const { archivebox_api_key, match_urls } = await chrome.storage.local.get([
    'archivebox_api_key',
    'match_urls'
  ]);
  
  serverUrl.value = archivebox_server_url;
  apiKey.value = archivebox_api_key || '';
  matchUrls.value = match_urls || '';

  // Server test button handler
  document.getElementById('testServer').addEventListener('click', async () => {
    const statusIndicator = document.getElementById('serverStatus');
    const statusText = document.getElementById('serverStatusText');

    // check if we have permission to access the server
    const permission = await chrome.permissions.request({permissions: ['cookies'], origins: [`${serverUrl.value}/*`]});
    if (!permission) {
      alert('Permission denied.');
      return;
    }

    const updateStatus = (success, message) => {
      updateStatusIndicator(statusIndicator, statusText, success, message);
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
        updateStatusIndicator(statusIndicator, statusText, true, `✓ API key is valid: user_id = ${data.user_id}`);
      } else {
        updateStatusIndicator(statusIndicator, statusText, false, `✗ API key error: ${response.status} ${response.statusText} ${JSON.stringify(data)}`);
      }
    } catch (err) {
      updateStatusIndicator(statusIndicator, statusText, false, `✗ API test failed: ${err.message}`);
    }
  });

  // Generate API key button handler
  document.getElementById('generateApiKey').addEventListener('click', () => {
    if (serverUrl.value) {
      window.open(`${serverUrl.value}/admin/api/apitoken/add/`, '_blank');
    } else {
      alert('Please enter a server URL first');
    }
  });

  // Login server button handler
  document.getElementById('loginServer').addEventListener('click', () => {
    if (serverUrl.value) {
      window.open(`${serverUrl.value}/admin`, '_blank');
    }
  });
  document.getElementById('loginAdminUILink').addEventListener('click', () => {
    if (serverUrl.value) {
      window.open(`${serverUrl.value}/admin/login/`, '_blank');
    }
  });
  document.getElementById('generateApiKeyLink').addEventListener('click', () => {
    if (serverUrl.value) {
      window.open(`${serverUrl.value}/admin/api/apitoken/add/`, '_blank');
    }
  });

  // Save changes when inputs change
  [serverUrl, apiKey, matchUrls].forEach(input => {
    input.addEventListener('change', async () => {
      await chrome.storage.local.set({
        archivebox_server_url: serverUrl.value.replace(/\/$/, ''),
        archivebox_api_key: apiKey.value,
        match_urls: matchUrls.value
      });
    });
  });

  // Test URL functionality
  const testUrlInput = document.getElementById('testUrl');
  const testButton = document.getElementById('testAdding');
  const testStatus = document.getElementById('urlStatusText');

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

// Using shared syncToArchiveBox function from utils.js
