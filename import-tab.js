let importItems = [];
let existingUrls = new Set();

export async function initializeImport() {
  const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
  existingUrls = new Set(snapshots.map(e => e.url));
  
  // Set default dates for history
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // Default to last 24 hours
  
  document.getElementById('historyStartDate').valueAsDate = startDate;
  document.getElementById('historyEndDate').valueAsDate = endDate;
  
  // Add event listeners
  document.getElementById('history-tab').addEventListener('click', loadHistory);
  document.getElementById('bookmarks-tab').addEventListener('click', loadBookmarks);
  document.getElementById('importFilter').addEventListener('input', filterImportItems);
  document.getElementById('showNewOnly').addEventListener('change', filterImportItems);
  document.getElementById('selectAll').addEventListener('click', () => toggleAllSelection(true));
  document.getElementById('deselectAll').addEventListener('click', () => toggleAllSelection(false));
  document.getElementById('selectAllHeader').addEventListener('change', e => toggleAllSelection(e.target.checked));
  document.getElementById('importSelected').addEventListener('click', importSelected);
}

async function loadHistory() {
  // request permission to access history
  const permission = await chrome.permissions.request({permissions: ['history']});
  if (!permission) {
    alert('Permission denied.');
    return;
  }

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
  // request permission to access bookmarks
  const permission = await chrome.permissions.request({permissions: ['bookmarks']});
  if (!permission) {
    alert('Permission denied.');
    return;
  }

  function processBookmarkTree(nodes) {
    let items = [];
    for (const node of nodes) {
      if (node.url) {
        items.push({
          url: node.url,
          title: node.title || '',
          timestamp: new Date().toISOString(),
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
  
  const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
  
  const newSnapshots = selectedItems.map(item => ({
    id: crypto.randomUUID(),
    url: item.url,
    title: item.title,
    timestamp: new Date().toISOString(),
    tags: [...tags],
  }));
  
  snapshots.push(...newSnapshots);
  await chrome.storage.local.set({ entries: snapshots });
  
  // Update existingUrls
  newSnapshots.forEach(snapshot => existingUrls.add(snapshot.url));
  
  // Clear selections and re-render
  importItems.forEach(item => item.selected = false);
  renderImportItems();
  
  // Clear tags input
  document.getElementById('importTags').value = '';
  
  // Show success message
  alert(`Successfully imported ${newSnapshots.length} items`);

  // redirect back to the URLs tab
  window.location.reload();
}
