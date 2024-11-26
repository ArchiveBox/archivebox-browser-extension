// popup.js
window.popupElement = null;  // Global reference to popup element
window.hideTimer = null;

window.getCurrentEntry = async function() {
  const { entries = [] } = await chrome.storage.sync.get('entries');
  let currentEntry = entries.find(entry => entry.url === window.location.href);
  
  if (!currentEntry) {
    currentEntry = {
      id: crypto.randomUUID(),
      url: String(window.location.href),
      timestamp: new Date().toISOString(),
      tags: [],
      title: document.title,
      notes: '',
    };
    entries.push(currentEntry);
    await chrome.storage.sync.set({ entries });  // Save immediately
  }
  currentEntry.id = currentEntry.id || crypto.randomUUID();
  currentEntry.url = currentEntry.url || window.location.href;
  currentEntry.timestamp = currentEntry.timestamp || new Date().toISOString();
  currentEntry.tags = currentEntry.tags || [];
  currentEntry.title = currentEntry.title || document.title;
  currentEntry.notes = currentEntry.notes || '';

  console.log('i Loaded current ArchiveBox snapshot', currentEntry);
  return { currentEntry, entries };  // Return both for atomic updates
}

window.getSuggestedTags = async function() {
  const { currentEntry, entries } = await getCurrentEntry();
  // Get all unique tags sorted by recency, excluding current entry's tags
  return [...new Set(
    entries
      .filter(entry => entry.url !== currentEntry.url)  // Better way to exclude current
      .reverse()
      .flatMap(entry => entry.tags)
  )]
  .filter(tag => !currentEntry.tags.includes(tag))
  .slice(0, 3);
}

window.updateCurrentTags = async function() {
  if (!popupElement) return;
  const currentTagsDiv = popupElement.querySelector('.ARCHIVEBOX__current-tags');
  const { currentEntry } = await getCurrentEntry();
  currentTagsDiv.innerHTML = currentEntry.tags.length 
    ? `${currentEntry.tags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge current" data-tag="${tag}">${tag}</span>`)
        .join(' ')}`
    : '';

  // Add click handlers for removing tags
  currentTagsDiv.querySelectorAll('.tag-badge.current').forEach(badge => {
    badge.addEventListener('click', async (e) => {
      if (e.target.classList.contains('current')) {
        const { currentEntry, entries } = await getCurrentEntry();
        const tagToRemove = e.target.dataset.tag;
        currentEntry.tags = currentEntry.tags.filter(tag => tag !== tagToRemove);
        await chrome.storage.sync.set({ entries });
        await updateCurrentTags();
        await updateSuggestions();
      }
    });
  });
}

window.updateSuggestions = async function() {
  if (!popupElement) return;
  const suggestionsDiv = popupElement.querySelector('.ARCHIVEBOX__tag-suggestions');
  const suggestedTags = await getSuggestedTags();
  suggestionsDiv.innerHTML = suggestedTags.length 
    ? `${suggestedTags
        .map(tag => `<span class="ARCHIVEBOX__tag-badge suggestion">${tag}</span>`)
        .join(' ')}`
    : '';
}

window.createPopup = async function() {
  const { currentEntry } = await getCurrentEntry();

  // Create popup container
  document.querySelector('.archive-box-popup')?.remove();
  popupElement = document.createElement('div');
  popupElement.className = 'archive-box-popup';
  popupElement.innerHTML = `
    <a href="#" class="options-link">🏛️</a>
    <input type="text" placeholder="Add tags + press enter to save">
    <br/>
    <div class="ARCHIVEBOX__current-tags"></div>
    <div class="ARCHIVEBOX__tag-suggestions"></div><br/>
    <small>Saved</small>
  `;
  
  document.body.appendChild(popupElement);
  
  // Add click handler for options link
  popupElement.querySelector('.options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'show-options' });
  });
  
  const input = popupElement.querySelector('input');
  const suggestionsDiv = popupElement.querySelector('.ARCHIVEBOX__tag-suggestions');
  
  // Initial display of current tags and suggestions
  await updateCurrentTags();
  await updateSuggestions();
  
  // Add click handlers for suggestion badges
  suggestionsDiv.addEventListener('click', async (e) => {
    if (e.target.classList.contains('suggestion')) {
      const { currentEntry, entries } = await getCurrentEntry();
      const tag = e.target.textContent.replace(' +', '');
      if (!currentEntry.tags.includes(tag)) {
        currentEntry.tags.push(tag);
        await chrome.storage.sync.set({ entries });
      }
    }
    await updateCurrentTags();
    await updateSuggestions();
  });
  
  // Handle input events
  input.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const { currentEntry, entries } = await getCurrentEntry();
      const newTags = input.value.split(',')
        .map(tag => tag.trim())
        .filter(tag => tag && !currentEntry.tags.includes(tag));
      
      console.log('Adding newTags', newTags);
      if (newTags.length > 0) {
        currentEntry.tags.push(...newTags);
        await chrome.storage.sync.set({ entries });
        input.value = '';
        console.log('√ Entries updated', entries);
        await updateSuggestions();
        await updateCurrentTags();
      } else if (input.value.trim() === '') {
        popupElement.remove();
        popupElement = null;
      }
    }
  });

  // Add escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupElement) {
      popupElement.remove();
      popupElement = null;
    }
  });
  
  input.focus();
  console.log('+ Showed ArchiveBox popup');
}
