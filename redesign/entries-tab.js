import { filterEntries, syncToArchiveBox, downloadCsv, downloadJson } from './utils.js';

export async function renderEntries(filterText = '', tagFilter = '') {
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

export async function handleDeleteFiltered(filterText = '') {
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

export async function handleSync(filterText = '') {
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

export function initializeEntriesTab() {
  let selectedEntries = new Set();
  let filteredTags = [];
  let selectedTagIndex = -1;

  // Initialize tag autocomplete and modal functionality
  async function initializeTagModal() {
    const modal = document.getElementById('editTagsModal');
    const input = document.getElementById('addTagInput');
    const dropdown = document.getElementById('tagAutocomplete');
    const currentTagsList = document.getElementById('currentTagsList');
    
    // Update current tags whenever modal is shown
    modal.addEventListener('show.bs.modal', async () => {
      await updateCurrentTagsList();
      input.value = '';
      dropdown.style.display = 'none';
    });

    // Handle tag input with autocomplete
    input.addEventListener('input', async () => {
      const inputValue = input.value.toLowerCase().trim();
      if (!inputValue) {
        dropdown.style.display = 'none';
        return;
      }

      const allTags = await getAllUniqueTags();
      const currentTags = getCurrentModalTags();
      
      // Filter tags that match input and aren't already used
      filteredTags = allTags
        .filter(tag => 
          tag.toLowerCase().includes(inputValue) && 
          !currentTags.includes(tag)
        )
        .slice(0, 5);  // Limit to 5 suggestions

      if (filteredTags.length === 0) {
        dropdown.style.display = 'none';
      } else {
        dropdown.innerHTML = filteredTags
          .map((tag, index) => `
            <div class="dropdown-item ${index === selectedTagIndex ? 'active' : ''}"
                 role="button" data-tag="${tag}">
              ${tag}
            </div>
          `)
          .join('');
        dropdown.style.display = 'block';
      }
    });

    // Handle keyboard navigation
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        selectedTagIndex = -1;
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedTagIndex >= 0 && filteredTags.length > 0) {
          await addTagToModal(filteredTags[selectedTagIndex]);
        } else if (input.value.trim()) {
          await addTagToModal(input.value.trim());
        }
        input.value = '';
        dropdown.style.display = 'none';
        selectedTagIndex = -1;
        return;
      }

      if (!filteredTags.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          selectedTagIndex = Math.min(selectedTagIndex + 1, filteredTags.length - 1);
          updateDropdownSelection();
          break;
        
        case 'ArrowUp':
          e.preventDefault();
          selectedTagIndex = Math.max(selectedTagIndex - 1, -1);
          updateDropdownSelection();
          break;
      }
    });

    // Handle click selection in dropdown
    dropdown.addEventListener('click', async (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        await addTagToModal(item.dataset.tag);
        input.value = '';
        dropdown.style.display = 'none';
        selectedTagIndex = -1;
      }
    });

    // Save changes button
    document.getElementById('saveTagChanges').addEventListener('click', async () => {
      const { entries = [] } = await chrome.storage.local.get('entries');
      const newTags = getCurrentModalTags();
      
      // Update tags for all selected entries
      entries.forEach(entry => {
        if (selectedEntries.has(entry.id)) {
          entry.tags = [...newTags];
        }
      });
      
      await chrome.storage.local.set({ entries });
      
      // Close modal and refresh view
      const modalInstance = bootstrap.Modal.getInstance(modal);
      modalInstance.hide();
      await renderEntries();
    });
  }

  async function getAllUniqueTags() {
    const { entries = [] } = await chrome.storage.local.get('entries');
    return [...new Set(entries.flatMap(entry => entry.tags))]
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  function getCurrentModalTags() {
    return Array.from(
      document.getElementById('currentTagsList')
        .querySelectorAll('.badge')
    ).map(badge => badge.dataset.tag);
  }

  function updateDropdownSelection() {
    const dropdown = document.getElementById('tagAutocomplete');
    dropdown.querySelectorAll('.dropdown-item').forEach((item, index) => {
      item.classList.toggle('active', index === selectedTagIndex);
    });
  }

  async function updateCurrentTagsList() {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedEntriesArray = entries.filter(e => selectedEntries.has(e.id));
    
    // Get tags that exist in ALL selected entries
    const commonTags = selectedEntriesArray.reduce((acc, entry) => {
      if (!acc) return new Set(entry.tags);
      return new Set([...acc].filter(tag => entry.tags.includes(tag)));
    }, null);

    const tagsList = document.getElementById('currentTagsList');
    tagsList.innerHTML = commonTags ? 
      Array.from(commonTags)
        .map(tag => `
          <span class="badge bg-secondary me-1 mb-1" role="button" data-tag="${tag}">
            ${tag} <i class="bi bi-x"></i>
          </span>
        `)
        .join('') : '';

    // Add click handlers for tag removal
    tagsList.querySelectorAll('.badge').forEach(badge => {
      badge.addEventListener('click', () => {
        badge.remove();
      });
    });
  }

  async function addTagToModal(tag) {
    const currentTags = getCurrentModalTags();
    if (!currentTags.includes(tag)) {
      const tagsList = document.getElementById('currentTagsList');
      const newTag = document.createElement('span');
      newTag.className = 'badge bg-secondary me-1 mb-1';
      newTag.setAttribute('role', 'button');
      newTag.dataset.tag = tag;
      newTag.innerHTML = `${tag} <i class="bi bi-x"></i>`;
      
      newTag.addEventListener('click', () => newTag.remove());
      tagsList.appendChild(newTag);
    }
  }

  function updateSelectionCount() {
    const count = selectedEntries.size;
    // Update count in main view
    document.getElementById('selectedUrlCount').textContent = count;
    // Update count in modal
    document.getElementById('selectedUrlCountModal').textContent = count;
  }

  function updateActionButtonStates() {
    const hasSelection = selectedEntries.size > 0;
    
    // Update all action buttons based on selection state
    [
      'downloadCsv',
      'downloadJson',
      'deleteFiltered',
      'syncFiltered',
      'editTags'
    ].forEach(buttonId => {
      const button = document.getElementById(buttonId);
      if (button) {
        button.disabled = !hasSelection;
        // Add visual feedback for disabled state
        button.classList.toggle('opacity-50', !hasSelection);
      }
    });
  }

  // Add handler for "Select All" checkbox in header if it exists
  const selectAllCheckbox = document.getElementById('selectAllUrls');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('click', async () => {
      const { entries = [] } = await chrome.storage.local.get('entries');
      const filterText = document.getElementById('filterInput').value.toLowerCase();
      
      // Get currently filtered entries
      const filteredEntries = entries.filter(entry => {
        const searchableText = [
          entry.url,
          entry.title,
          entry.id,
          ...entry.tags
        ].join(' ').toLowerCase();
        
        return searchableText.includes(filterText);
      });

      // If all filtered entries are selected, deselect all
      const allFilteredSelected = filteredEntries.every(entry => 
        selectedEntries.has(entry.id)
      );

      if (allFilteredSelected) {
        // Deselect only the filtered entries
        filteredEntries.forEach(entry => {
          selectedEntries.delete(entry.id);
        });
      } else {
        // Select all filtered entries
        filteredEntries.forEach(entry => {
          selectedEntries.add(entry.id);
        });
      }

      await renderEntries();
    });
  }

  // Add handler for "Deselect All" button
  const deselectAllButton = document.getElementById('deselectAllUrls');
  if (deselectAllButton) {
    deselectAllButton.addEventListener('click', () => {
      selectedEntries.clear();
      renderEntries();
    });
  }

  // Add handler for individual checkbox changes
  document.getElementById('entriesList').addEventListener('change', (e) => {
    if (e.target.classList.contains('entry-checkbox')) {
      if (e.target.checked) {
        selectedEntries.add(e.target.value);
      } else {
        selectedEntries.delete(e.target.value);
      }
      updateSelectionCount();
      updateActionButtonStates();
    }
  });

  // Get initial filter value from URL
  function getInitialFilter() {
    const params = new URLSearchParams(window.location.search);
    return params.get('search') || '';
  }

  // Update URL with current filter
  function updateFilterUrl(filterText) {
    const newUrl = filterText 
      ? `${window.location.pathname}?search=${encodeURIComponent(filterText)}`
      : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  }

  async function renderTagsList(filteredEntries) {
    const tagsList = document.getElementById('tagsList');
    
    // Count occurrences of each tag in filtered entries only
    const tagCounts = filteredEntries.reduce((acc, entry) => {
      entry.tags.forEach(tag => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {});

    // Sort tags by frequency (descending) then alphabetically
    const sortedTags = Object.entries(tagCounts)
      .sort(([tagA, countA], [tagB, countB]) => {
        if (countB !== countA) return countB - countA;
        return tagA.localeCompare(tagB);
      });

    // Get current filter to highlight active tag if any
    const currentFilter = document.getElementById('filterInput').value.toLowerCase();

    // Render tags list with counts
    tagsList.innerHTML = sortedTags.map(([tag, count]) => `
      <a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center tag-filter ${
        tag.toLowerCase() === currentFilter ? 'active' : ''
      }" data-tag="${tag}">
        ${tag}
        <span class="badge bg-secondary rounded-pill">${count}</span>
      </a>
    `).join('');

    // Add click handlers for tag filtering
    tagsList.querySelectorAll('.tag-filter').forEach(tagElement => {
      tagElement.addEventListener('click', (e) => {
        e.preventDefault();
        const tag = tagElement.dataset.tag;
        const filterInput = document.getElementById('filterInput');
        
        // Toggle tag filter
        if (filterInput.value.toLowerCase() === tag.toLowerCase()) {
          filterInput.value = ''; // Clear filter if clicking active tag
        } else {
          filterInput.value = tag;
        }
        
        renderEntries();
      });
    });
  }

  // Modify existing renderEntries function
  async function renderEntries() {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const filterText = document.getElementById('filterInput').value.toLowerCase();
    const entriesList = document.getElementById('entriesList');
    
    // Update URL when filter changes
    updateFilterUrl(filterText);
    
    // Filter entries based on search text
    const filteredEntries = entries.filter(entry => {
      const searchableText = [
        entry.url,
        entry.title,
        entry.id,
        ...entry.tags
      ].join(' ').toLowerCase();
      
      return searchableText.includes(filterText);
    });

    // Add CSS for URL truncation if not already present
    if (!document.getElementById('entriesListStyles')) {
      const style = document.createElement('style');
      style.id = 'entriesListStyles';
      style.textContent = `
        .entry-url {
          max-width: 800px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-block;
        }
        .entry-title {
          font-size: 0.9em;
          color: #666;
          margin-bottom: 4px;
        }
        .entry-timestamp {
          font-size: 0.8em;
          color: #888;
          margin-left: 8px;
        }
        .entry-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .entry-url-line {
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `;
      document.head.appendChild(style);
    }

    // Render entries list
    entriesList.innerHTML = filteredEntries.map(entry => `
      <div class="list-group-item d-flex align-items-start gap-2">
        <input type="checkbox" 
               class="entry-checkbox form-check-input mt-2" 
               value="${entry.id}"
               ${selectedEntries.has(entry.id) ? 'checked' : ''}>
        <div class="entry-content flex-grow-1">
          <div class="entry-title">${entry.title || 'Untitled'}</div>
          <div class="entry-url-line">
            <img class="favicon" src="${entry.favicon || 'icons/128.png'}" 
                 onerror="this.src='icons/128.png'"
                 width="16" height="16">
            <code class="entry-url">${entry.url}</code>
            <span class="entry-timestamp">
              ${new Date(entry.timestamp).toLocaleString()}
            </span>
          </div>
          <div class="small text-muted mt-1">
            ${entry.tags.map(tag => 
              `<span class="badge bg-secondary me-1">${tag}</span>`
            ).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Update selection count and action buttons
    updateSelectionCount();
    updateActionButtonStates();

    // Update tags list with filtered entries
    await renderTagsList(filteredEntries);
  }

  // Initialize filter input with URL parameter and trigger initial render
  const filterInput = document.getElementById('filterInput');
  filterInput.value = getInitialFilter();

  // Handle filter input changes with debounce
  let filterTimeout;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      renderEntries();
    }, 300);
  });

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    filterInput.value = getInitialFilter();
    renderEntries();
  });

  // Initialize the tag modal when the entries tab is initialized
  initializeTagModal();

  // Initial render
  renderEntries();

  // Export to CSV
  document.getElementById('downloadCsv').addEventListener('click', async () => {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedItems = entries.filter(e => selectedEntries.has(e.id));
    
    if (!selectedItems.length) {
      alert('No entries selected');
      return;
    }

    // CSV Header
    const csvRows = [
      ['ID', 'Timestamp', 'URL', 'Title', 'Tags'].join(',')
    ];

    // CSV Data Rows
    selectedItems.forEach(entry => {
      const row = [
        entry.id,
        entry.timestamp,
        `"${entry.url.replace(/"/g, '""')}"`, // Escape quotes in URL
        `"${(entry.title || '').replace(/"/g, '""')}"`, // Escape quotes in title
        `"${entry.tags.join(', ')}"` // Join tags with comma
      ];
      csvRows.push(row.join(','));
    });

    // Create and trigger download
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `archivebox-export-${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  // Export to JSON
  document.getElementById('downloadJson').addEventListener('click', async () => {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedItems = entries.filter(e => selectedEntries.has(e.id));
    
    if (!selectedItems.length) {
      alert('No entries selected');
      return;
    }

    // Create formatted JSON with selected fields
    const exportData = selectedItems.map(entry => ({
      id: entry.id,
      timestamp: entry.timestamp,
      url: entry.url,
      title: entry.title || '',
      tags: entry.tags
    }));

    // Create and trigger download
    const jsonContent = JSON.stringify(exportData, null, 2); // Pretty print with 2 spaces
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `archivebox-export-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}

// // Helper function to sync a single entry to ArchiveBox
// async function syncToArchiveBox(entry) {
//   const { archivebox_server_url, archivebox_api_key } = await chrome.storage.local.get([
//     'archivebox_server_url',
//     'archivebox_api_key'
//   ]);

//   if (!archivebox_server_url || !archivebox_api_key) {
//     return { ok: false, status: 'Server not configured' };
//   }

//   try {
//     const response = await fetch(`${archivebox_server_url}/api/v1/cli/add`, {
//       method: 'POST',
//       mode: 'cors',
//       credentials: 'omit',
//       headers: {
//         'Accept': 'application/json',
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         api_key: archivebox_api_key,
//         urls: [entry.url],
//         tag: entry.tags.join(','),
//         depth: 0,
//         update: false,
//         update_all: false,
//       }),
//     });

//     return {
//       ok: response.ok,
//       status: `${response.status} ${response.statusText}`
//     };
//   } catch (err) {
//     return { ok: false, status: `Connection failed ${err}` };
//   }
// } 
