let currentPersonas = [];

async function detectCurrentSettings(personaId) {
  const {personas} = await chrome.storage.local.get('personas');
  const persona = personas.find(p => p.id === personaId);

  console.log('Updating settings for profile:', personaId, persona.settings);

  const settings = {
    userAgent: persona.settings.userAgent || navigator.userAgent,
    language: persona.settings.language || navigator.language,
    timezone: persona.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: persona.settings.viewport || `${window.innerWidth}x${window.innerHeight}`,
    operatingSystem: persona.settings.operatingSystem || detectOS(),
    geography: persona.settings.geography || await detectGeography()
  };

  persona.settings = settings;

  await chrome.storage.local.set({ personas });
  await loadPersonas();
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

async function removePersonaDomain(personaId, domain) {
  const persona = currentPersonas.find(p => p.id === personaId);
  if (!persona) return;
  delete persona.cookies[domain];
  await chrome.storage.local.set({ personas: currentPersonas });
  await loadPersonas();
}

async function loadPersonas() {
  let { personas = [], activePersona = '' } = await chrome.storage.local.get(['personas', 'activePersona']);
  currentPersonas = personas;

  // if no personas exist, create a default one
  if (!personas || personas.length === 0) {
    createNewPersona('Private');
    createNewPersona('Work');
    createNewPersona('Anonymous');
    ({ personas, activePersona } = await chrome.storage.local.get(['personas', 'activePersona']));
  }

  if (!activePersona) {
    await chrome.storage.local.set({ activePersona: currentPersonas[0].id });
    activePersona = currentPersonas[0].id;
  }
  window.activePersona = activePersona;
  window.personas = personas;
  
  // Update persona selector
  const select = document.getElementById('activePersona');
  select.innerHTML = `
    <option value="">Select a profile...</option>
    ${(personas || []).map(p => `
      <option value="${p.id}" ${p.id === activePersona ? 'selected' : ''}>
        ${p.name}
      </option>
    `).join('')}
  `;
  
  // Update persona table
  const tbody = document.getElementById('personaTable').querySelector('tbody');
  tbody.innerHTML = (personas || []).map(p => `
    <tr data-id="${p.id}" class="${p.id === activePersona ? 'table-primary' : ''}">
      <td>
        <input type="text" class="form-control form-control-sm persona-name" 
               value="${p.name}" data-original="${p.name}">
      </td>
      <td>
        ${Object.keys(p.cookies || {}).length} domains<br/>
        ${Object.keys(p.cookies || {}).map(domain => `<button class="btn btn-sm btn-outline-danger remove-persona-domain" data-persona-id="${p.id}" data-persona-domain="${domain}">${domain} ❌</button>`).join(' ')}
      </td>
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
          <button class="btn btn-sm btn-outline-secondary detect-settings mb-1" data-id="${p.id}">
            ⚙️ Detect Browser Settings
          </button>
          <button class="btn btn-sm btn-outline-secondary export-cookies mb-1" data-id="${p.id}">
            📋 Export <code>cookies.txt</code>
          </button>
          <button class="btn btn-sm btn-outline-primary save-settings mb-1" data-id="${p.id}" style="display: none;">
            ✅ Save Changes
          </button>
          <button class="btn btn-sm btn-outline-danger delete-persona" data-id="${p.id}">
            ❌ Delete Profile
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

  // add event listener for remove-persona-domain
  document.querySelectorAll('.remove-persona-domain').forEach(button => {
    button.addEventListener('click', () => {
      removePersonaDomain(button.dataset.personaId, button.dataset.personaDomain);
    });
  });

  // add event listener for detect-settings
  document.querySelectorAll('.detect-settings').forEach(button => {
    button.addEventListener('click', async () => {
      await detectCurrentSettings(button.dataset.id);
    });
  });
  
  // Update stats for active persona
  updatePersonaStats(activePersona);
  
  // Update import button state
  document.getElementById('importCookies').disabled = !activePersona;
}
window.loadPersonas = loadPersonas;

async function createNewPersona(default_name) {
  const name = default_name || prompt('Enter name for new profile:');
  if (!name) return;
  
  const persona = {
    id: crypto.randomUUID(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    cookies: {},
    settings: {},
  };

  currentPersonas.push(persona);
  await chrome.storage.local.set({ personas: currentPersonas });
  await loadPersonas();
  const settings = await detectCurrentSettings(persona.id);
  persona.settings = settings;
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
    stats.textContent = 'No active profile selected';
    return;
  }
  
  const persona = currentPersonas.find(p => p.id === personaId);
  if (!persona) return;
  
  const domainCount = Object.keys(persona.cookies || {}).length;
  const cookieCount = Object.values(persona.cookies || {}).reduce((sum, cookies) => sum + cookies.length, 0);
  
  stats.innerHTML = `${domainCount} domains <br/> ${cookieCount} cookies`;
}

async function deletePersona(id) {
  if (!confirm('Delete this profile? This cannot be undone.')) return;
  
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

// Using formatCookiesForExport from utils.js

async function exportPersonaCookies(id) {
  const persona = currentPersonas.find(p => p.id === id);
  if (!persona) return;
  
  const text = formatCookiesForExport(persona.cookies);
  await navigator.clipboard.writeText(text);
  alert(`${Object.keys(persona.cookies).length} domain logins (${Object.values(persona.cookies).reduce((sum, cookies) => sum + cookies.length, 0)} cookies) copied to clipboard for "${persona.name}"! Save them into cookies.txt on your ArchiveBox server and run: archivebox config --set COOKIES_FILE=/path/to/cookies.txt`);
}

import { formatCookiesForExport } from './utils.js';

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


  // Load initial data
  loadPersonas();
} 
