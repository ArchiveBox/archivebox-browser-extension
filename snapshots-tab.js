import { filterSnapshots, addToArchiveBox, downloadCsv, downloadJson, updateStatusIndicator, getArchiveBoxServerUrl } from './utils.js';

export function initializeSnapshotsTab() {
  let selectedSnapshots = new Set();
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
      const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
      const newTags = getCurrentModalTags();
      
      // Update tags for all selected snapshots
      snapshots.forEach(snapshot => {
        if (selectedSnapshots.has(snapshot.id)) {
          snapshot.tags = [...newTags];
        }
      });
      
      await chrome.storage.local.set({ entries: snapshots });
      
      // Close modal and refresh view
      const modalInstance = bootstrap.Modal.getInstance(modal);
      modalInstance.hide();
      await renderSnapshots();
    });
  }

  async function getAllUniqueTags() {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    return [...new Set(snapshots.flatMap(snapshot => snapshot.tags))]
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
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const selectedSnapshotsArray = snapshots.filter(e => selectedSnapshots.has(e.id));
    
    // Get tags that exist in ALL selected snapshots
    const commonTags = selectedSnapshotsArray.reduce((acc, snapshot) => {
      if (!acc) return new Set(snapshot.tags);
      return new Set([...acc].filter(tag => snapshot.tags.includes(tag)));
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
    const count = selectedSnapshots.size;
    // Update count in main view
    document.getElementById('selectedUrlCount').textContent = count;
    // Update count in modal
    document.getElementById('selectedUrlCountModal').textContent = count;
  }

  function updateActionButtonStates() {
    const hasSelection = selectedSnapshots.size > 0;
    
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
      const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
      const filterText = document.getElementById('filterInput').value.toLowerCase();
      
      // Get currently filtered snapshots
      const filteredSnapshots = filterSnapshots(snapshots, filterText);

      // If all filtered snapshots are selected, deselect all
      const allFilteredSelected = filteredSnapshots.every(snapshot => 
        selectedSnapshots.has(snapshot.id)
      );

      if (allFilteredSelected) {
        // Deselect only the filtered snapshots
        filteredSnapshots.forEach(snapshot => {
          selectedSnapshots.delete(snapshot.id);
        });
      } else {
        // Select all filtered snapshot
        filteredSnapshots.forEach(snapshot => {
          selectedSnapshots.add(snapshot.id);
        });
      }

      await renderSnapshots();
    });
  }

  // Add handler for "Deselect All" button
  const deselectAllButton = document.getElementById('deselectAllUrls');
  if (deselectAllButton) {
    deselectAllButton.addEventListener('click', () => {
      selectedSnapshots.clear();
      renderSnapshots();
    });
  }

  // Add handler for individual checkbox changes
  document.getElementById('snapshotsList').addEventListener('change', (e) => {
    if (e.target.classList.contains('snapshot-checkbox')) {
      if (e.target.checked) {
        selectedSnapshots.add(e.target.value);
      } else {
        selectedSnapshots.delete(e.target.value);
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

  async function renderTagsList(filteredSnapshots) {
    const tagsList = document.getElementById('tagsList');
    
    // Count occurrences of each tag in filtered snapshots only
    const tagCounts = filteredSnapshots.reduce((acc, snapshot) => {
      snapshot.tags.forEach(tag => {
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
        
        renderSnapshots();
      });
    });
  }

  // Modify existing renderSnapshots function
  async function renderSnapshots() {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const archivebox_server_url = await getArchiveBoxServerUrl();

    const filterText = document.getElementById('filterInput').value.toLowerCase();
    const snapshotsList = document.getElementById('snapshotsList');
    
    // Update URL when filter changes
    updateFilterUrl(filterText);
    
    // Filter snapshots based on search text
    const filteredSnapshots = filterSnapshots(snapshots, filterText);

    // sort snapshots by timestamp, newest first
    filteredSnapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Add CSS for URL truncation if not already present
    if (!document.getElementById('snapshotsListStyles')) {
      const style = document.createElement('style');
      style.id = 'snapshotsListStyles';
      style.textContent = `
        .snapshot-url {
          max-width: 800px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-block;
        }
        .snapshot-title-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .snapshot-title {
          font-size: 0.9em;
          color: #666;
          margin-bottom: 4px;
        }
        .snapshot-link-to-archivebox {
          font-size: 0.7em;
          color: #888;
          min-width: 330px;
        }
        .snapshot-timestamp {
          font-size: 0.8em;
          color: #888;
          margin-left: 8px;
        }
        .snapshot-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .snapshot-url-line {
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `;
      document.head.appendChild(style);
    }

    // Render snapshots list
    snapshotsList.innerHTML = filteredSnapshots.map(snapshot => `
      <div class="list-group-item d-flex align-items-start gap-2">
        <input type="checkbox" 
               class="snapshot-checkbox form-check-input mt-2" 
               value="${snapshot.id}"
               ${selectedSnapshots.has(snapshot.id) ? 'checked' : ''}>
        <div class="snapshot-content flex-grow-1">
          <div class="snapshot-title-line">
            <div class="snapshot-title">${snapshot.title || 'Untitled'}</div>
            ${(()=>{
              return archivebox_server_url ?
                `<div class="snapshot-link-to-archivebox btn-group" role="group">
                   <a href=${snapshot.url} target="_blank" class="btn btn-sm btn-outline-primary">
                     🔗 Original
                   </a>
                   <a href=${archivebox_server_url}/archive/${snapshot.url} target="_blank" class="btn btn-sm btn-outline-primary">
                     📦 ArchiveBox
                   </a>
                   <a href="https://web.archive.org/web/${snapshot.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                     🏛️ Archive.org
                   </a>
                 </div>`
                : '' })()
            }
          </div>
          <div class="snapshot-url-line">
            <img class="favicon" src="${snapshot.favIconUrl || '128.png'}"
                 onerror="this.src='128.png'"
                 width="16" height="16">
            <code class="snapshot-url">${snapshot.url}</code>
            <span class="snapshot-timestamp">
              ${new Date(snapshot.timestamp).toLocaleString()}
            </span>
          </div>
          <div class="small text-muted mt-1">
            ${snapshot.tags.map(tag => 
              `<span class="badge bg-secondary me-1">${tag}</span>`
            ).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Update selection count and action buttons
    updateSelectionCount();
    updateActionButtonStates();

    // Update tags list with filtered snapshots
    await renderTagsList(filteredSnapshots);
  }

  // Initialize filter input with URL parameter and trigger initial render
  const filterInput = document.getElementById('filterInput');
  filterInput.value = getInitialFilter();

  // Handle filter input changes with debounce
  let filterTimeout;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      renderSnapshots();
    }, 300);
  });

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    filterInput.value = getInitialFilter();
    renderSnapshots();
  });

  // Initialize the tag modal when the snapshots tab is initialized
  initializeTagModal();

  // Initial render
  renderSnapshots();

  // Export to CSV
  document.getElementById('downloadCsv').addEventListener('click', async () => {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const selectedItems = snapshots.filter(e => selectedSnapshots.has(e.id));
    
    if (!selectedItems.length) {
      alert('No snapshots selected');
      return;
    }

    downloadCsv(selectedItems);
  });

  // Export to JSON
  document.getElementById('downloadJson').addEventListener('click', async () => {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const selectedItems = snapshots.filter(e => selectedSnapshots.has(e.id));
    
    if (!selectedItems.length) {
      alert('No snapshots selected');
      return;
    }

    downloadJson(selectedItems);
  });

  // Delete snapshots
  document.getElementById('deleteFiltered').addEventListener('click', async () => {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const selectedItems = snapshots.filter(e => selectedSnapshots.has(e.id));
    console.log(`deleting ${selectedItems.length} items from local storage`)

    if (!selectedItems.length) {
      alert('No snapshots to delete');
      return;
    }

    const message = `Delete ${selectedItems.length} snapshots?`

    if (!confirm(message)) return;

    const idsToDelete = new Set(selectedItems.map(e => e.id));
    const remainingSnapshots = snapshots.filter(e => !idsToDelete.has(e.id));
    await chrome.storage.local.set({ entries: remainingSnapshots });

    // Refresh the view
    await renderSnapshots();
  });

  // Sync snapshots
  document.getElementById('syncFiltered').addEventListener('click', async () => {
    const { entries: snapshots = [] } = await chrome.storage.local.get('entries');
    const selectedItems = snapshots.filter(e => selectedSnapshots.has(e.id));
    console.log(`syncing ${selectedItems.length} items to ArchiveBox server`)

    if (!selectedItems.length) {
      alert('No selectedItems to sync');
      return;
    }

    const syncBtn = document.getElementById('syncFiltered');
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Syncing...';

    // Process selectedItems one at a time
    for (const item of selectedItems) {
      const row = document.querySelector(`input[value="${item.id}"]`);
      if (!row) continue;
      const snapshot = row.parentElement.querySelector('.snapshot-title');

      // Add status indicator if it doesn't exist
      let statusIndicator = snapshot.querySelector('.sync-status');
      if (!statusIndicator) {
        statusIndicator = document.createElement('span');
        statusIndicator.className = 'sync-status status-indicator';
        statusIndicator.style.marginLeft = '10px';
        snapshot.appendChild(statusIndicator);
      }

      // Update status to "in progress"
      statusIndicator.className = 'sync-status status-indicator';
      statusIndicator.style.backgroundColor = '#ffc107'; // yellow
      // animate the status indicator pulsing until the request is complete
      statusIndicator.style.animation = 'pulse 1s infinite';

      // Send to ArchiveBox
      let success = true, status = 'success';
      try {
        await addToArchiveBox([item.url], item.tags);
        success = true;
        status = 'success';
      } catch (error) {
        success = false;
        status = error.message;
      }

      statusIndicator.className = `sync-status status-indicator status-${success ? 'success' : 'error'}`;
      statusIndicator.style.backgroundColor = success ? '#28a745' : '#dc3545';
      statusIndicator.title = status;
      statusIndicator.style.animation = 'none';

      // Wait 0.5s before next request
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Reset button state
    syncBtn.disabled = false;
    syncBtn.textContent = '⬆️ Sync to ArchiveBox';  
  });
}
