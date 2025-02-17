let currentPersonas = [];

async function detectCurrentSettings() {
  const settings = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    operatingSystem: detectOS(),
    geography: await detectGeography()
  };
  return settings;
}

function detectOS() {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS')) return 'iOS';
  return 'Unknown';
}

async function detectGeography() {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();
    return `${data.city}, ${data.country_name}`;
  } catch (error) {
    console.error('Failed to detect geography:', error);
    return 'Unknown';
  }
}

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
    <tr data-id="${p.id}">
      <td>
        <input type="text" class="form-control form-control-sm persona-name" 
               value="${p.name}" data-original="${p.name}">
      </td>
      <td>${Object.keys(p.cookies || {}).length} domains</td>
      <td>${p.lastUsed ? new Date(p.lastUsed).toLocaleString() : 'Never'}</td>
      <td>
        <div class="settings-grid">
          <div class="mb-2">
            <label class="form-label small">User Agent</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="userAgent" value="${p.settings?.userAgent || ''}">
          </div>
          <div class="mb-2">
            <label class="form-label small">Geography</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="geography" value="${p.settings?.geography || ''}">
          </div>
          <div class="mb-2">
            <label class="form-label small">Timezone</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="timezone" value="${p.settings?.timezone || ''}">
          </div>
          <div class="mb-2">
            <label class="form-label small">Language</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="language" value="${p.settings?.language || ''}">
          </div>
          <div class="mb-2">
            <label class="form-label small">Operating System</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="operatingSystem" value="${p.settings?.operatingSystem || ''}">
          </div>
          <div class="mb-2">
            <label class="form-label small">Viewport Size</label>
            <input type="text" class="form-control form-control-sm persona-setting" 
                   data-setting="viewport" value="${p.settings?.viewport || ''}">
          </div>
        </div>
      </td>
      <td>
        <div class="btn-group-vertical">
          <button class="btn btn-sm btn-outline-secondary export-cookies mb-1" data-id="${p.id}">
            Export Cookies
          </button>
          <button class="btn btn-sm btn-outline-primary save-settings mb-1" data-id="${p.id}" style="display: none;">
            Save Changes
          </button>
          <button class="btn btn-sm btn-outline-danger delete-persona" data-id="${p.id}">
            Delete
          </button>
        </div>
      </td>
    </tr>
  `).join('');
  
  // Add change detection for settings
  tbody.querySelectorAll('tr').forEach(row => {
    const saveBtn = row.querySelector('.save-settings');
    const inputs = row.querySelectorAll('input');
    
    inputs.forEach(input => {
      input.addEventListener('input', () => {
        const hasChanges = Array.from(inputs).some(input => {
          const originalValue = input.dataset.original || '';
          return input.value !== originalValue;
        });
        saveBtn.style.display = hasChanges ? 'block' : 'none';
      });
    });
  });
  
  // Update stats for active persona
  updatePersonaStats(activePersona);
  
  // Update import button state
  document.getElementById('importCookies').disabled = !activePersona;
}

async function createNewPersona() {
  const name = prompt('Enter name for new persona:');
  if (!name) return;
  
  const settings = await detectCurrentSettings();
  
  const persona = {
    id: crypto.randomUUID(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    cookies: {},
    settings
  };
  
  currentPersonas.push(persona);
  await chrome.storage.local.set({ personas: currentPersonas });
  await loadPersonas();
}

async function savePersonaSettings(id) {
  const persona = currentPersonas.find(p => p.id === id);
  if (!persona) return;
  
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  
  // Update name
  const nameInput = row.querySelector('.persona-name');
  persona.name = nameInput.value;
  nameInput.dataset.original = nameInput.value;
  
  // Update settings
  persona.settings = persona.settings || {};
  row.querySelectorAll('.persona-setting').forEach(input => {
    persona.settings[input.dataset.setting] = input.value;
    input.dataset.original = input.value;
  });
  
  await chrome.storage.local.set({ personas: currentPersonas });
  row.querySelector('.save-settings').style.display = 'none';
  
  // Refresh UI
  await loadPersonas();
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

export function initializePersonasTab() {
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
    } else if (button.classList.contains('save-settings')) {
      await savePersonaSettings(id);
    }
  });

  // Add settings-related event listeners
  document.getElementById('detectCurrentSettings').addEventListener('click', async () => {
    const settings = await detectCurrentSettings();
    document.querySelectorAll('tr[data-id]').forEach(row => {
      Object.entries(settings).forEach(([key, value]) => {
        const input = row.querySelector(`[data-setting="${key}"]`);
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input'));
        }
      });
    });
  });

  // Load initial data
  loadPersonas();
} 
