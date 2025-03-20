import { filterEntries, addToArchiveBox, downloadCsv, downloadJson, syncToArchiveBox, updateStatusIndicator, getArchiveBoxServerUrl } from './utils.js';
import { getAllHandlers, shouldCaptureUrl } from './site-handlers.js';

/**
 * Get site handler information for an entry
 * @param {Object} entry - The entry to get handler info for
 * @return {Object|null} Handler info if found
 */
async function getSiteHandlerForEntry(entry) {
  if (!entry || !entry.url) return null;
  
  try {
    // Send message to background script
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'getSiteHandlerForUrl', url: entry.url },
        response => resolve(response?.handler || null)
      );
    });
  } catch (error) {
    console.error('Error getting site handler for entry:', error);
    return null;
  }
}

function getSiteHandlerIcon(handlerId) {
  const icons = {
    reddit: '💬',
    twitter: '🐦',
    youtube: '▶️',
    default: '🌐'
  };
  
  return icons[handlerId] || icons.default;
}

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
  // Add a custom style for site handler badges if not already present
  if (!document.getElementById('siteHandlerStyles')) {
    const style = document.createElement('style');
    style.id = 'siteHandlerStyles';
    style.textContent = `
      .site-handler-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        font-size: 0.7rem;
        background-color: #e3f2fd;
        color: #0d6efd;
        border-radius: 4px;
        margin-right: 8px;
      }
      
      .site-handler-icon {
        margin-right: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  // Get site handler info for each entry
  const entryHandlers = await Promise.all(
    filteredEntries.map(async entry => {
      return {
        entry,
        handler: await getSiteHandlerForEntry(entry)
      };
    })
  );

  entriesList.innerHTML = entryHandlers.map(({ entry, handler }) => `
    <div class="list-group-item d-flex align-items-start gap-2">
      <input type="checkbox" 
             class="entry-checkbox form-check-input mt-2" 
             value="${entry.id}"
             ${selectedEntries.has(entry.id) ? 'checked' : ''}>
      <div class="entry-content flex-grow-1">
        <div class="entry-title-line">
          <div class="entry-title">
            ${handler ? 
              `<span class="site-handler-badge">
                <span class="site-handler-icon">${getSiteHandlerIcon(handler.id)}</span>
                ${handler.name}
              </span>` : ''
            }
            ${entry.title || 'Untitled'}
          </div>
          ${(()=>{
            return archivebox_server_url ?
              `<div class="entry-link-to-archivebox btn-group" role="group">
                 <a href=${entry.url} target="_blank" class="btn btn-sm btn-outline-primary">
                   🔗 Original
                 </a>
                 <a href=${archivebox_server_url}/archive/${entry.url} target="_blank" class="btn btn-sm btn-outline-primary">
                   📦 ArchiveBox
                 </a>
                 <a href="https://web.archive.org/web/${entry.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                   🏛️ Archive.org
                 </a>
               </div>`
              : '' })()
          }
        </div>
        <div class="entry-url-line">
          <img class="favicon" src="${entry.favicon || '128.png'}"
               onerror="this.src='128.png'"
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
      const filteredEntries = filterEntries(entries, filterText);

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

  /**
   * Render the tags list sidebar with frequency counts and site filters
   * @param {Array} filteredEntries - The currently filtered entries
   */
  async function renderTagsList(filteredEntries) {
    const tagsList = document.getElementById('tagsList');
    
    // Add site handler filters
    const handlers = getAllHandlers();
    
    // Check if we have entries from supported sites
    const siteCount = {};
    
    filteredEntries.forEach(entry => {
      Object.entries(handlers).forEach(([id, handler]) => {
        if (handler.domains.some(domain => entry.url.includes(domain))) {
          siteCount[id] = (siteCount[id] || 0) + 1;
        }
      });
    });
    
    // Start with site filters if we have entries from supported sites
    let tagsListHTML = '';
    
    if (Object.keys(siteCount).length > 0) {
      tagsListHTML += '<h5>Sites</h5>';
      
      // Get current filter to highlight active site if any
      const currentFilter = document.getElementById('filterInput').value.toLowerCase();
      
      // Add site filters sorted by count
      tagsListHTML += Object.entries(siteCount)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([siteId, count]) => {
          const handler = handlers[siteId];
          const isActive = currentFilter === `site:${siteId}`;
          
          return `
            <a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center site-filter ${
              isActive ? 'active' : ''
            }" data-site="${siteId}">
              <span>
                ${getSiteHandlerIcon(siteId)} ${handler.name}
              </span>
              <span class="badge bg-primary rounded-pill">${count}</span>
            </a>
          `;
        }).join('');
      
      tagsListHTML += '<h5 class="mt-4">Tags</h5>';
    }
    
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
  
    // Add tags with counts
    tagsListHTML += sortedTags.map(([tag, count]) => `
      <a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center tag-filter ${
        tag.toLowerCase() === currentFilter ? 'active' : ''
      }" data-tag="${tag}">
        ${tag}
        <span class="badge bg-secondary rounded-pill">${count}</span>
      </a>
    `).join('');
  
    // Set the HTML
    tagsList.innerHTML = tagsListHTML;
  
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
    
    // Add click handlers for site filtering
    tagsList.querySelectorAll('.site-filter').forEach(siteElement => {
      siteElement.addEventListener('click', (e) => {
        e.preventDefault();
        const site = siteElement.dataset.site;
        const filterInput = document.getElementById('filterInput');
        
        // Toggle site filter
        if (filterInput.value.toLowerCase() === `site:${site}`) {
          filterInput.value = ''; // Clear filter if clicking active site
        } else {
          filterInput.value = `site:${site}`;
        }
        
        renderEntries();
      });
    });
  }

  // Modify existing renderEntries function
  async function renderEntries() {
    const { entries = [] } = await chrome.storage.local.get(['entries']);
    const archivebox_server_url = await getArchiveBoxServerUrl();

    const filterText = document.getElementById('filterInput').value.toLowerCase();
    const entriesList = document.getElementById('entriesList');
    
    // Update URL when filter changes
    updateFilterUrl(filterText);
    
    // Filter entries based on search text
    const filteredEntries = filterEntries(entries, filterText);

    // sort entries by timestamp, newest first
    filteredEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
        .entry-title-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .entry-title {
          font-size: 0.9em;
          color: #666;
          margin-bottom: 4px;
        }
        .entry-link-to-archivebox {
          font-size: 0.7em;
          color: #888;
          min-width: 330px;
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
          <div class="entry-title-line">
            <div class="entry-title">${entry.title || 'Untitled'}</div>
            ${(()=>{
              return archivebox_server_url ?
                `<div class="entry-link-to-archivebox btn-group" role="group">
                   <a href=${entry.url} target="_blank" class="btn btn-sm btn-outline-primary">
                     🔗 Original
                   </a>
                   <a href=${archivebox_server_url}/archive/${entry.url} target="_blank" class="btn btn-sm btn-outline-primary">
                     📦 ArchiveBox
                   </a>
                   <a href="https://web.archive.org/web/${entry.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                     🏛️ Archive.org
                   </a>
                 </div>`
                : '' })()
            }
          </div>
          <div class="entry-url-line">
            <img class="favicon" src="${entry.favicon || '128.png'}"
                 onerror="this.src='128.png'"
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

    downloadCsv(selectedItems);
  });

  // Export to JSON
  document.getElementById('downloadJson').addEventListener('click', async () => {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedItems = entries.filter(e => selectedEntries.has(e.id));
    
    if (!selectedItems.length) {
      alert('No entries selected');
      return;
    }

    downloadJson(selectedItems);
  });

  // Delete entries
  document.getElementById('deleteFiltered').addEventListener('click', async () => {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedItems = entries.filter(e => selectedEntries.has(e.id));
    console.log(`deleting ${selectedItems.length} items from local storage`)

    if (!selectedItems.length) {
      alert('No entries to delete');
      return;
    }

    const message = `Delete ${selectedItems.length} entries?`

    if (!confirm(message)) return;

    const idsToDelete = new Set(selectedItems.map(e => e.id));
    const remainingEntries = entries.filter(e => !idsToDelete.has(e.id));
    await chrome.storage.local.set({ entries: remainingEntries });

    // Refresh the view
    await renderEntries('');
  });

  // Sync entries
  document.getElementById('syncFiltered').addEventListener('click', async () => {
    const { entries = [] } = await chrome.storage.local.get('entries');
    const selectedItems = entries.filter(e => selectedEntries.has(e.id));
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
      const entryTitle = row.parentElement.querySelector('.entry-title');

      // Add status indicator if it doesn't exist
      let statusIndicator = entryTitle.querySelector('.sync-status');
      if (!statusIndicator) {
        statusIndicator = document.createElement('span');
        statusIndicator.className = 'sync-status status-indicator';
        statusIndicator.style.marginLeft = '10px';
        entryTitle.appendChild(statusIndicator);
      }

      // Update status to "in progress"
      statusIndicator.className = 'sync-status status-indicator';
      statusIndicator.style.backgroundColor = '#ffc107'; // yellow
      // animate the status indicator pulsing until the request is complete
      statusIndicator.style.animation = 'pulse 1s infinite';

      // Send to ArchiveBox
      const addCommandArgs = JSON.stringify({urls: [item.url], tag: item.tags.join(',')});

      const onResponse = (response) => {
        // Update status indicator
        statusIndicator.className = `sync-status status-indicator status-${response.ok ? 'success' : 'error'}`;
        statusIndicator.style.backgroundColor = response.ok ? '#28a745' : '#dc3545';
        statusIndicator.title = response.status;
        statusIndicator.style.animation = 'none';
      }

      addToArchiveBox(addCommandArgs, onResponse, onResponse);

      // Wait 0.5s before next request
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Reset button state
    syncBtn.disabled = false;
    syncBtn.textContent = '⬆️ Sync to ArchiveBox';  
  });
}

// Using syncToArchiveBox from utils.js 
