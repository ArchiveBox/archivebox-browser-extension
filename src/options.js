import { initializeEntriesTab } from './entries-tab.js';
import { initializeImport } from './import-tab.js';
import { initializePersonasTab } from './personas-tab.js';
import { initializeCookiesTab } from './cookies-tab.js';
import { initializeConfigTab } from './config-tab.js';
import { initializeS3Tab } from './s3-tab.js';

// Initialize all tabs when options page loads
document.addEventListener('DOMContentLoaded', () => {
  initializeEntriesTab();
  initializeImport();
  initializePersonasTab();
  initializeCookiesTab();
  initializeConfigTab();
  initializeS3Tab();

  function changeTab() {
    if (window.location.hash && window.location.hash !== document.querySelector('a.nav-link.active').id) {
      console.log('Changing tab based on URL hash:', window.location.hash, `a.nav-link${window.location.hash}`, document.querySelector(`a.nav-link${window.location.hash}`));
      // document.querySelector(`a.nav-link${window.location.hash}`).click();
    }
  }
  // changeTab();
  window.addEventListener('hashchange', changeTab);

  var tabEls = document.querySelectorAll('a.nav-link[data-bs-toggle="tab"]')
  for (const tabEl of tabEls) {
    tabEl.addEventListener('shown.bs.tab', function (event) {
      console.log('ArchiveBox tab switched to:', event.target);
      event.target // newly activated tab
      event.relatedTarget // previous active tab
      // window.location.hash = event.target.id;
    })
  }
});
