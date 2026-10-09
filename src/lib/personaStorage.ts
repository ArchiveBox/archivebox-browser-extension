import { Dexie } from 'dexie';
import { exportDB } from 'dexie-export-import';
import type { Persona, PersonaOriginStorage, PersonaTabStorage } from './types';

// Runs in the isolated content-script world, against the page's actual origin.
export async function captureOriginStorage() {
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
  const entries = (storage: Storage) => Object.entries(storage).map(([name, value]) => ({ name, value }));
  return {
    origin: location.origin, url: location.href,
    localStorage: entries(localStorage), sessionStorage: entries(sessionStorage), indexedDB: exports,
  };
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
  const tabs = (await browser.tabs.query({})).filter(tab => {
    if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return false;
    return matchesDomain(tab.url);
  });
  if (!tabs.length) return previous;
  if (!await browser.permissions.contains({ permissions: ['scripting'] })) {
    throw new Error('Allow browser storage access when importing cookies, then sync this profile again.');
  }
  const origins = new Map<string, PersonaOriginStorage>((previous?.origins || []).map(origin => [origin.origin, origin]));
  const savedTabs: PersonaTabStorage[] = [];
  for (const tab of tabs) {
    await browser.scripting.executeScript({ target: { tabId: tab.id! }, files: ['/content-scripts/persona-storage.js'] });
    const state = await browser.tabs.sendMessage(tab.id!, { type: 'persona_capture_storage' }) as Awaited<ReturnType<typeof captureOriginStorage>>;
    if (!state || state.origin !== new URL(tab.url!).origin) throw new Error('The tab changed while exporting browser storage; sync again.');
    origins.set(state.origin, { origin: state.origin, localStorage: state.localStorage, indexedDB: state.indexedDB });
    savedTabs.push({ url: state.url, sessionStorage: state.sessionStorage });
  }
  // Preserve closed-tab sessions too. A live tab replaces only its own URL's saved state.
  const currentUrls = new Set(savedTabs.map(tab => tab.url));
  return { origins: [...origins.values()], tabs: [...(previous?.tabs || []).filter(tab => !currentUrls.has(tab.url)), ...savedTabs] };
}
