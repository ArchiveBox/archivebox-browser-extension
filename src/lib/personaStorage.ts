import { Dexie } from 'dexie';
import { exportDB } from 'dexie-export-import';
import type { Persona, PersonaOriginStorage, PersonaTabStorage } from './types';

// Runs in the isolated content-script world, against the page's actual origin.
// localStorage and IndexedDB are shared by every tab of an origin, so only one
// tab per origin exports them. sessionStorage belongs to each tab.
export async function captureOriginStorage(includeOrigin: boolean) {
  const entries = (storage: Storage) => Object.entries(storage).map(([name, value]) => ({ name, value }));
  const tab = { origin: location.origin, url: location.href, sessionStorage: entries(sessionStorage) };
  if (!includeOrigin) return tab;
  const databases = await indexedDB.databases();
  const exports: PersonaOriginStorage['indexedDB'] = [];
  for (const database of databases) {
    if (!database.name) continue;
    const db = new Dexie(database.name);
    try {
      await db.open();
      const native = db.backendDB();
      const transaction = native.objectStoreNames.length ? native.transaction([...native.objectStoreNames]) : null;
      const stores = [...native.objectStoreNames].map(name => {
        const store = transaction!.objectStore(name);
        return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          indexes: [...store.indexNames].map(name => { const index = store.index(name);
            return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }) };
      });
      exports.push({ name: native.name, version: native.version, stores, data: await (await exportDB(db)).text() });
    } finally { db.close(); }
  }
  return { ...tab, localStorage: entries(localStorage), indexedDB: exports };
}

export async function capturePersonaStorage(persona: Persona) {
  const domains = Object.keys(persona.cookies).map(domain => domain.replace(/^\./, ''));
  const matchesDomain = (url: string) => {
    const hostname = new URL(url).hostname;
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  };
  const previous = persona.storage && {
    origins: persona.storage.origins.filter(entry => matchesDomain(entry.origin)),
    tabs: persona.storage.tabs.filter(tab => matchesDomain(tab.url)),
  };
  // Discarded tabs and restored tabs the browser has not loaded yet are both
  // "unloaded" (only the former is marked discarded) and have no page to read.
  const tabs = (await browser.tabs.query({})).filter(tab => {
    if (!tab.id || !tab.url || tab.status === 'unloaded' || !/^https?:/.test(tab.url)) return false;
    return matchesDomain(tab.url);
  });
  // Browser storage is optional profile state: without scripting access, or for
  // any tab that cannot be read, the last saved storage is kept and cookies still sync.
  if (!tabs.length || !await browser.permissions.contains({ permissions: ['scripting'] })) return previous;
  const origins = new Map<string, PersonaOriginStorage>((previous?.origins || []).map(origin => [origin.origin, origin]));
  const exportedOrigins = new Set<string>();
  const savedTabs: PersonaTabStorage[] = [];
  for (const tab of tabs) {
    const { origin, protocol, hostname } = new URL(tab.url!);
    try {
      // Site access restricted in browser settings is withheld: injecting there
      // waits for a toolbar click, which would hang the sync.
      if (!await browser.permissions.contains({ origins: [`${protocol}//${hostname}/*`] })) continue;
      await browser.scripting.executeScript({ target: { tabId: tab.id! }, files: ['/content-scripts/persona-storage.js'] });
      const state = await browser.tabs.sendMessage(tab.id!, { type: 'persona_capture_storage', includeOrigin: !exportedOrigins.has(origin) }) as Awaited<ReturnType<typeof captureOriginStorage>>;
      if (state?.origin !== origin) throw new Error('The tab navigated during export.');
      if ('localStorage' in state) {
        origins.set(origin, { origin, localStorage: state.localStorage, indexedDB: state.indexedDB });
        exportedOrigins.add(origin);
      }
      savedTabs.push({ url: state.url, sessionStorage: state.sessionStorage });
    } catch (error) {
      console.warn(`ArchiveBox: kept saved browser storage for a ${origin} tab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Preserve closed-tab sessions too. A live tab replaces only its own URL's saved state.
  const currentUrls = new Set(savedTabs.map(tab => tab.url));
  return { origins: [...origins.values()], tabs: [...(previous?.tabs || []).filter(tab => !currentUrls.has(tab.url)), ...savedTabs] };
}
