// Config tab initialization and handlers
import { updateStatusIndicator, syncToArchiveBox, getArchiveBoxServerUrl } from './utils.js';
import { getAllHandlers, getAllStats } from './site-handlers.js';

export async function initializeConfigTab() {
  const configForm = document.getElementById('configForm');
  const serverUrl = document.getElementById('archivebox_server_url');
  const apiKey = document.getElementById('archivebox_api_key');
  const matchUrls = document.getElementById('match_urls');
  const excludeUrls = document.getElementById('exclude_urls');
  
  // Load saved values
  const archivebox_server_url = await getArchiveBoxServerUrl();
  const { archivebox_api_key, match_urls, exclude_urls } = await chrome.storage.local.get([
    'archivebox_api_key',
    'match_urls',
    'exclude_urls',
  ]);

  // migrate old config_archiveboxBaseUrl to archivebox_server_url
  const {config_archiveBoxBaseUrl} = await chrome.storage.sync.get('config_archiveBoxBaseUrl', );
  if (config_archiveBoxBaseUrl) {
    await chrome.storage.local.set({ archivebox_server_url: config_archiveBoxBaseUrl });
  }
  
  serverUrl.value = archivebox_server_url || '';
  apiKey.value = archivebox_api_key || '';
  matchUrls.value = typeof match_urls === 'string' ? match_urls : '';
  excludeUrls.value = typeof exclude_urls === 'string' ? exclude_urls : '';

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
  [serverUrl, apiKey, matchUrls, excludeUrls].forEach(input => {
    input.addEventListener('change', async () => {
      await chrome.storage.local.set({
        archivebox_server_url: serverUrl.value.replace(/\/$/, ''),
        archivebox_api_key: apiKey.value.trim(),
        match_urls: matchUrls.value,
        exclude_urls: excludeUrls.value,
      });
    });
  });

  // Test URL functionality
  const testUrlInput = document.getElementById('testUrl');
  const testButton = document.getElementById('testAdding');
  const testStatus = document.getElementById('urlStatusText');

  testButton.addEventListener('click', async () => {
    const url = testUrlInput.value.trim();

    // test if the URL matches the regex match patterns
    let matchPattern;
    try {
      matchPattern = new RegExp(matchUrls.value || /^$/);
    } catch (error) {
      testStatus.innerHTML = `
        <span class="status-indicator status-error"></span>
        Error with match pattern: ${error.message}<br/>
      `;
      return;
    }

    if (matchPattern.test(url)) {
      testStatus.innerHTML = `
        <span class="status-indicator status-success"></span>
        ➕ URL would be auto-archived when visited<br/>
      `;
    } else {
      testStatus.innerHTML = `
        <span class="status-indicator status-warning"></span>
        ☝ URL does not match the auto-archive pattern (but it can still be saved manually)<br/>
      `;
    }

    // test if the URL matches the regex exclude patterns
    let excludePattern;
    try {
      excludePattern = new RegExp(excludeUrls.value || /^$/);
      if (excludePattern.test(url)) {
        testStatus.innerHTML = `
        <span class="status-indicator status-warning"></span>
          🚫 URL is excluded from auto-archiving (but it can still be saved manually)<br/>
        `;
      }
    } catch (error) {
      testStatus.innerHTML = `
        <span class="status-indicator status-error"></span>
        Error with exclude pattern: ${error.message}<br/>
      `;
    }

    if (!url) {
      testStatus.innerHTML = `
        <span class="status-indicator status-error"></span>
        ⌨️ Please enter a URL to test
      `;
      return;
    }

    // Show loading state
    testButton.disabled = true;
    testStatus.innerHTML += `
      <span id="inprogress-test">
        &nbsp; &nbsp; <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Submitting...
      </span>
    `;

    try {
      const testEntry = {
        url,
        title: 'Test Entry',
        timestamp: new Date().toISOString(),
        tags: ['test']
      };

      const result = await syncToArchiveBox(testEntry);
      document.getElementById('inprogress-test')?.remove();

      if (result.ok) {
        testStatus.innerHTML += `
          &nbsp; <span class="status-indicator status-success"></span>
          🚀 URL was submitted and <a href="${serverUrl.value}/" target="_blank">✓ queued for archiving</a> on the ArchiveBox server: <a href="${serverUrl.value}/archive/${testEntry.url}" target="_blank">📦 <code>${serverUrl.value}/archive/${testEntry.url}</code></a>.
        `;
        // Clear the input on success
        testUrlInput.value = '';
      } else {
        testStatus.innerHTML += `
          <span class="status-indicator status-error"></span>
          Error: ${result.status}
        `;
      }
    } catch (error) {
      testStatus.innerHTML += `
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

  // Initialize site-specific capture settings
  await initializeSiteCapture();
}

/**
 * Initialize site-specific capture settings
 */
async function initializeSiteCapture() {
  // Load scroll capture settings
  const enableScrollCapture = document.getElementById('enableScrollCapture');
  const scrollCaptureTags = document.getElementById('scrollCaptureTags');

  const { 
    enableScrollCapture: savedEnableScrollCapture, 
    scrollCaptureTags: savedScrollCaptureTags,
    redditCaptureConfig
  } = await chrome.storage.local.get([
    'enableScrollCapture', 
    'scrollCaptureTags',
    'redditCaptureConfig'
  ]);

  enableScrollCapture.checked = !!savedEnableScrollCapture;
  scrollCaptureTags.value = savedScrollCaptureTags || '';

  // Add event handlers for scroll capture settings
  enableScrollCapture.addEventListener('change', async () => {
    await chrome.storage.local.set({ enableScrollCapture: enableScrollCapture.checked });
    
    // Notify all tabs of the change
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'captureStatusChanged',
          enabled: enableScrollCapture.checked
        }).catch(() => {/* Ignore errors for tabs that don't have the content script */});
      } catch (e) {
        // Ignore errors for tabs that don't have the content script
      }
    }
  });

  scrollCaptureTags.addEventListener('change', async () => {
    await chrome.storage.local.set({ scrollCaptureTags: scrollCaptureTags.value });
  });

  // Initialize Reddit-specific settings
  await initializeRedditSettings(redditCaptureConfig);
  
  // Add site handlers information
  populateSiteHandlersInfo();
  
  // Add capture stats display
  await updateCaptureStats();
  
  // Set up stats refresh button
  document.getElementById('refreshCaptureStats')?.addEventListener('click', updateCaptureStats);
}

/**
 * Initialize Reddit-specific settings
 */
async function initializeRedditSettings(savedConfig) {
  // Default configuration
  const defaultConfig = {
    captureSubreddits: true,
    capturePostDetails: true,
    captureComments: false,
    commentsDepth: 2,
    excludedSubreddits: [],
    includedSubreddits: [],
    maxProcessedPosts: 1000
  };

  // Merge saved config with defaults
  const config = { ...defaultConfig, ...(savedConfig || {}) };
  
  // Create Reddit-specific settings UI if it doesn't exist
  const redditSettingsContainer = document.getElementById('redditSettingsContainer');
  if (!redditSettingsContainer) {
    return; // Element doesn't exist, can't add settings
  }
  
  // Build the Reddit settings UI
  redditSettingsContainer.innerHTML = `
    <div class="card mb-4">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Reddit Capture Settings</h5>
      </div>
      <div class="card-body">
        <div class="row mb-3">
          <div class="col-md-6">
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="redditCaptureSubreddits" ${config.captureSubreddits ? 'checked' : ''}>
              <label class="form-check-label" for="redditCaptureSubreddits">
                Save subreddit information
              </label>
            </div>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="redditCapturePostDetails" ${config.capturePostDetails ? 'checked' : ''}>
              <label class="form-check-label" for="redditCapturePostDetails">
                Save post details (upvotes, author)
              </label>
            </div>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="redditCaptureComments" ${config.captureComments ? 'checked' : ''}>
              <label class="form-check-label" for="redditCaptureComments">
                Save post comments
              </label>
            </div>
          </div>
          <div class="col-md-6">
            <div class="mb-3">
              <label for="redditCommentsDepth" class="form-label">Comments depth to capture</label>
              <select class="form-select" id="redditCommentsDepth">
                <option value="1" ${config.commentsDepth === 1 ? 'selected' : ''}>Top-level comments only</option>
                <option value="2" ${config.commentsDepth === 2 ? 'selected' : ''}>Two levels deep</option>
                <option value="3" ${config.commentsDepth === 3 ? 'selected' : ''}>Three levels deep</option>
                <option value="0" ${config.commentsDepth === 0 ? 'selected' : ''}>All available comments</option>
              </select>
            </div>
            <div class="mb-3">
              <label for="redditMaxProcessedPosts" class="form-label">Maximum processed posts</label>
              <input type="number" class="form-control" id="redditMaxProcessedPosts" value="${config.maxProcessedPosts}" min="100" max="10000">
              <div class="form-text">Maximum number of post IDs to keep in memory (100-10000)</div>
            </div>
          </div>
        </div>
        
        <div class="row mb-3">
          <div class="col-md-6">
            <label for="redditIncludedSubreddits" class="form-label">Only capture these subreddits (leave empty for all)</label>
            <input type="text" class="form-control" id="redditIncludedSubreddits" placeholder="comma,separated,subreddits" value="${config.includedSubreddits.join(',')}">
            <div class="form-text">Only posts from these subreddits will be captured</div>
          </div>
          <div class="col-md-6">
            <label for="redditExcludedSubreddits" class="form-label">Excluded subreddits</label>
            <input type="text" class="form-control" id="redditExcludedSubreddits" placeholder="comma,separated,subreddits" value="${config.excludedSubreddits.join(',')}">
            <div class="form-text">Posts from these subreddits will never be captured</div>
          </div>
        </div>
        
        <button class="btn btn-primary" id="saveRedditSettings">Save Reddit Settings</button>
      </div>
    </div>
  `;
  
  // Add event listener for saving settings
  document.getElementById('saveRedditSettings').addEventListener('click', async () => {
    // Collect the current settings
    const newConfig = {
      captureSubreddits: document.getElementById('redditCaptureSubreddits').checked,
      capturePostDetails: document.getElementById('redditCapturePostDetails').checked,
      captureComments: document.getElementById('redditCaptureComments').checked,
      commentsDepth: parseInt(document.getElementById('redditCommentsDepth').value, 10),
      maxProcessedPosts: parseInt(document.getElementById('redditMaxProcessedPosts').value, 10),
      includedSubreddits: document.getElementById('redditIncludedSubreddits').value
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s),
      excludedSubreddits: document.getElementById('redditExcludedSubreddits').value
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s)
    };
    
    // Validate settings
    if (newConfig.maxProcessedPosts < 100) newConfig.maxProcessedPosts = 100;
    if (newConfig.maxProcessedPosts > 10000) newConfig.maxProcessedPosts = 10000;
    
    // Save the settings
    await chrome.storage.local.set({ redditCaptureConfig: newConfig });
    
    // Show success message
    alert('Reddit settings saved successfully');
  });
}

/**
 * Populate site handlers information
 */
function populateSiteHandlersInfo() {
  const handlersContainer = document.getElementById('siteHandlersContainer');
  if (!handlersContainer) return;
  
  const handlers = getAllHandlers();
  
  // Create the handlers info UI
  handlersContainer.innerHTML = `
    <div class="card mt-4">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Site Handlers</h5>
      </div>
      <div class="card-body">
        <table class="table">
          <thead>
            <tr>
              <th>Handler</th>
              <th>Domains</th>
              <th>Version</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(handlers).map(([id, handler]) => `
              <tr>
                <td>${handler.name}</td>
                <td>${handler.domains.join(', ')}</td>
                <td>${handler.version}</td>
                <td>${handler.description}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Update capture stats
 */
async function updateCaptureStats() {
  const statsContainer = document.getElementById('captureStatsContainer');
  if (!statsContainer) return;
  
  // Get stats from all handlers
  const stats = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'getStats' }, response => {
      resolve(response?.stats || {});
    });
  });
  
  // Create the stats UI
  statsContainer.innerHTML = `
    <div class="card mt-4">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Capture Statistics</h5>
        <button class="btn btn-sm btn-outline-secondary" id="refreshCaptureStats">
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
      </div>
      <div class="card-body">
        <div class="row">
          ${Object.entries(stats).map(([site, siteStats]) => `
            <div class="col-md-4 mb-3">
              <div class="card h-100">
                <div class="card-header">
                  <h6 class="mb-0">${site.charAt(0).toUpperCase() + site.slice(1)} Stats</h6>
                </div>
                <div class="card-body">
                  <ul class="list-group list-group-flush">
                    ${Object.entries(siteStats).map(([key, value]) => `
                      <li class="list-group-item d-flex justify-content-between align-items-center">
                        ${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        <span class="badge bg-primary rounded-pill">${value}</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  // Re-attach the refresh button event listener
  document.getElementById('refreshCaptureStats')?.addEventListener('click', updateCaptureStats);
}

// Using shared syncToArchiveBox function from utils.js
