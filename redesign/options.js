// options.js
// Add these functions at the top
function filterEntries(entries, filterText) {
  if (!filterText) return entries;
  
  const searchTerms = filterText.toLowerCase().split(' ');
  return entries.filter(entry => {
    const searchableText = [
      entry.url,
      entry.title,
      entry.id,
      new Date(entry.timestamp).toISOString(),
      ...entry.tags
    ].join(' ').toLowerCase();
    
    return searchTerms.every(term => searchableText.includes(term));
  });
}

async function renderEntries(filterText = '', tagFilter = '') {
  const { entries = [] } = await chrome.storage.sync.get('entries');
  
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

// Add this function near the top
function downloadCsv(entries) {
  // Define CSV headers and prep data
  const headers = ['id', 'timestamp', 'url', 'title', 'tags', 'notes'];
  const csvRows = [
    headers.join(','), // Header row
    ...entries.map(entry => {
      return [
        entry.id,
        entry.timestamp,
        `"${entry.url}"`,  // Wrap URL in quotes to handle commas
        `"${entry.title || ''}"`, // Handle titles with commas
        `"${entry.tags.join(';')}"`, // Join tags with semicolon
        `"${entry.notes || ''}"` // Handle notes with commas
      ].join(',');
    })
  ];

  // Create and trigger download
  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Add this function near downloadCsv
function downloadJson(entries) {
  const jsonContent = JSON.stringify(entries, null, 2); // Pretty print with 2 spaces
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `archivebox-export-${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Add this function near the other event handlers
async function handleDeleteFiltered(filterText = '') {
  const { entries = [] } = await chrome.storage.sync.get('entries');
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
  await chrome.storage.sync.set({ entries: remainingEntries });
  
  // Refresh the view
  await renderEntries(filterText);
}

// Modify the loadOptions function to add the download handler
async function loadOptions() {
  // Initial render
  // get search query from url
  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get('search');
  await renderEntries(searchQuery);
  
  // Set up filter input handler
  const filterInput = document.getElementById('filterInput');
  let debounceTimeout;
  filterInput.value = filterInput.value || searchQuery;
  
  filterInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      renderEntries(e.target.value);
    }, 150); // Debounce for better performance
  });
  
  // Collect and display all unique tags
  const { entries = [] } = await chrome.storage.sync.get('entries');
  const allTags = [...new Set(entries.flatMap(entry => entry.tags))];
  const tagsList = document.getElementById('tagsList');
  tagsList.innerHTML = allTags.map(tag => `
    <div class="list-group-item d-flex justify-content-between align-items-center tag-filter" role="button" data-tag="${tag}">
      ${tag}
      <span class="badge bg-primary rounded-pill">
        ${entries.filter(entry => entry.tags.includes(tag)).length}
      </span>
    </div>
  `).join('');

  // Add click handlers for sidebar tag filtering
  tagsList.querySelectorAll('.tag-filter').forEach(tagItem => {
    tagItem.addEventListener('click', () => {
      const tagText = tagItem.dataset.tag;
      const filterInput = document.getElementById('filterInput');
      filterInput.value = tagText;
      renderEntries(tagText);
    });
  });

  // Add download CSV handler
  const downloadBtn = document.getElementById('downloadCsv');
  const downloadJsonBtn = document.getElementById('downloadJson');
  
  downloadBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    const { entries = [] } = await chrome.storage.sync.get('entries');
    const filteredEntries = filterEntries(entries, filterInput.value);
    downloadCsv(filteredEntries);
  });

  downloadJsonBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    const { entries = [] } = await chrome.storage.sync.get('entries');
    const filteredEntries = filterEntries(entries, filterInput.value);
    downloadJson(filteredEntries);
  });

  // Add delete handler
  const deleteBtn = document.getElementById('deleteFiltered');
  deleteBtn.addEventListener('click', async () => {
    const filterInput = document.getElementById('filterInput');
    await handleDeleteFiltered(filterInput.value);
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);
