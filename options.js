import { initializeEntriesTab } from './entries-tab.js';
import { initializeImport } from './import-tab.js';
import { initializePersonasTab } from './personas-tab.js';
import { initializeCookiesTab } from './cookies-tab.js';
import { initializeConfigTab } from './config-tab.js';

// Initialize all tabs when options page loads
document.addEventListener('DOMContentLoaded', () => {
  initializeEntriesTab();
  initializeImport();
  initializePersonasTab();
  initializeCookiesTab();
  initializeConfigTab();
});
