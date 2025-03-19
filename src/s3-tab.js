// S3 Configuration tab initialization and handlers
import { updateStatusIndicator } from './utils.js';

export async function initializeS3Tab() {
  const s3Form = document.getElementById('s3Form');
  const endpoint = document.getElementById('s3_endpoint');
  const region = document.getElementById('s3_region');
  const bucket = document.getElementById('s3_bucket');
  const accessKeyId = document.getElementById('s3_access_key_id');
  const secretAccessKey = document.getElementById('s3_secret_access_key');
  
  const { s3config } = await chrome.storage.sync.get(['s3config']);
  
  if (s3config) {
    endpoint.value = s3config.endpoint || '';
    region.value = s3config.region || '';
    bucket.value = s3config.bucket || '';
    accessKeyId.value = s3config.accessKeyId || '';
    secretAccessKey.value = s3config.secretAccessKey || '';
  }

  document.getElementById('saveS3Config').addEventListener('click', async () => {
      const statusIndicator = document.getElementById('s3ConfigStatus');
      const statusText = document.getElementById('s3ConfigStatusText');
    
      let endpointValue = endpoint.value.trim();

      if (endpointValue && !endpointValue.startsWith('http://') && !endpointValue.startsWith('https://')) {
        endpointValue = 'https://' + endpointValue;
      }

      if (endpointValue.endsWith('/')) {
        endpointValue = endpointValue.slice(0, -1);
      }
    
    try {
      const config = {
        endpoint: endpointValue,
        region: region.value.trim(),
        bucket: bucket.value.trim(),
        accessKeyId: accessKeyId.value.trim(),
        secretAccessKey: secretAccessKey.value.trim()
      };

      // Check for missing or empty values
      for (const [key, value] of Object.entries(config)) {
        if (value === undefined || value === null || value === '') {
          throw new Error(`Missing or empty configuration field: ${key}`);
        }
      }
      console.log('Saving config: ', config);
      chrome.storage.sync.set({ s3config: config });
      updateStatusIndicator(statusIndicator, statusText, true, '✓ S3 Configuration saved successfully');
    } catch (err) {
      updateStatusIndicator(statusIndicator, statusText, false, `✗ Failed to save configuration: ${err.message}`);
    }
  });

  document.getElementById('testS3Credentials').addEventListener('click', async () => {
    const statusIndicator = document.getElementById('s3TestStatus');
    const statusText = document.getElementById('s3TestStatusText');
    
    statusText.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Testing S3 credentials...
    `;
    
    console.log("Testing connection to S3...")
    try {
      const response = await chrome.runtime.sendMessage({ type: 'test_s3' });
      
      if (response === 'success') {
        updateStatusIndicator(statusIndicator, statusText, true, '✓ Connection to S3 successful');
      } else {
        updateStatusIndicator(statusIndicator, statusText, false, `✗ Connection to S3 failed`);
      }
    } catch (err) {
      updateStatusIndicator(statusIndicator, statusText, false, `✗ Error testing credentials: ${err.message}`);
    }
  });
}
