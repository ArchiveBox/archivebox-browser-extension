let availableCookies = [];
let selectedCookieDomains = new Set();

export async function loadAvailableCookies() {
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

function formatCookiesForExport(cookies) {
  return Object.entries(cookies).map(([domain, domainCookies]) => {
    return `# ${domain}\n${domainCookies.map(cookie => 
      `${cookie.name}=${cookie.value}; domain=${cookie.domain}; path=${cookie.path}`
    ).join('\n')}`;
  }).join('\n\n');
}

async function importSelectedCookies() {
  const { activePersona } = await chrome.storage.local.get('activePersona');
  if (!activePersona) {
    alert('Please select an active persona first');
    return;
  }
  
  const { personas = [] } = await chrome.storage.local.get('personas');
  const persona = personas.find(p => p.id === activePersona);
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
  await chrome.storage.local.set({ personas });
  
  // Clear selection
  selectedCookieDomains.clear();
  availableCookies.forEach(item => item.selected = false);
  
  // Refresh UI
  renderCookieTable(document.getElementById('cookieFilter').value);
  
  alert(`Successfully imported cookies from ${importCount} domains to "${persona.name}"`);
}

export function initializeCookiesTab() {
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
  loadAvailableCookies();
} 
