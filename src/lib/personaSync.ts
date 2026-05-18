import { formatCookiesAsNetscape } from './cookies';
import { t } from './i18n';
import { requestServerHostPermission } from './archivebox';
import { getConfig } from './storage';
import type { Persona, StoredCookie } from './types';

type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable };

type PageAuthStorage = {
  indexedDB: Record<string, Serializable>;
  localStorage: Record<string, string>;
  origin: string;
  sessionStorage: Record<string, string>;
};

type ScriptingApi = {
  executeScript<T = unknown>(details: {
    target: { tabId: number };
    func: () => T | Promise<T>;
  }): Promise<Array<{ result?: T }>>;
};

type PersonaSyncResponse = {
  created?: boolean;
  persona?: {
    id?: string;
    name?: string;
  };
  success?: boolean;
};

function getScriptingApi(): ScriptingApi | undefined {
  return (browser as unknown as { scripting?: ScriptingApi }).scripting;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? {
      Authorization: `Bearer ${apiKey}`,
      'X-ArchiveBox-API-Key': apiKey,
      'x-archivebox-api-key': apiKey,
    } : {}),
  };
}

function toViewportSize(viewport?: string): string {
  const match = (viewport || '').match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return '';
  return `${match[1]},${match[2]}`;
}

function cookieDomains(persona: Persona): string[] {
  return [...new Set([
    ...Object.keys(persona.cookies || {}),
    ...Object.values(persona.cookies || {})
      .flat()
      .map((cookie) => cookie.domain.replace(/^\./, '')),
  ])]
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function tabMatchesPersonaDomains(tabUrl: string | undefined, domains: string[]): boolean {
  if (!tabUrl || domains.length === 0) return false;
  try {
    const hostname = new URL(tabUrl).hostname.toLowerCase();
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function tabOriginPattern(tabUrl: string): string | null {
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function cookieForAuthJson(cookie: StoredCookie): Record<string, Serializable> {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || '',
    expirationDate: cookie.expirationDate || null,
  };
}

function geolocationFromBrowser(): Promise<Persona['settings']['geolocation']> {
  if (!navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: 4000,
      },
    );
  });
}

function collectPageAuthStorage(): Promise<PageAuthStorage> {
  function makeSerializable(value: unknown): Serializable {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 100).map(makeSerializable);
    }
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value)) as Serializable;
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  async function dumpIndexedDB(): Promise<Record<string, Serializable>> {
    if (!indexedDB.databases) return {};

    const result: Record<string, Serializable> = {};
    const databases = (await indexedDB.databases()).filter((database) => database.name).slice(0, 10);

    for (const database of databases) {
      const databaseName = database.name;
      if (!databaseName) continue;

      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error(`Unable to open IndexedDB database ${databaseName}`));
          request.onblocked = () => reject(new Error(`IndexedDB database ${databaseName} is blocked`));
        });

        try {
          const stores: Record<string, Serializable> = {};
          for (const storeName of Array.from(db.objectStoreNames).slice(0, 20)) {
            try {
              const transaction = db.transaction(storeName, 'readonly');
              const records = await requestToPromise(transaction.objectStore(storeName).getAll(undefined, 100));
              stores[storeName] = makeSerializable(records);
            } catch {
              stores[storeName] = [];
            }
          }
          result[databaseName] = stores;
        } finally {
          db.close();
        }
      } catch {
        result[databaseName] = {};
      }
    }

    return result;
  }

  return (async () => ({
    origin: window.location.origin,
    localStorage: Object.fromEntries(Object.entries(window.localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
    indexedDB: await dumpIndexedDB(),
  }))();
}

async function collectOpenTabAuthStorage(persona: Persona): Promise<{
  indexedDB: Record<string, Serializable>;
  localStorage: Record<string, Record<string, string>>;
  sessionStorage: Record<string, Record<string, string>>;
}> {
  const domains = cookieDomains(persona);
  if (domains.length === 0) {
    return { indexedDB: {}, localStorage: {}, sessionStorage: {} };
  }

  const scripting = getScriptingApi();
  if (!scripting) {
    return { indexedDB: {}, localStorage: {}, sessionStorage: {} };
  }

  const grantedApiPermissions = await browser.permissions.request({
    permissions: ['tabs', 'scripting'],
  }).catch(() => false);
  if (!grantedApiPermissions) {
    return { indexedDB: {}, localStorage: {}, sessionStorage: {} };
  }

  const tabs = (await browser.tabs.query({}).catch(() => []))
    .filter((tab) => tab.id && tabMatchesPersonaDomains(tab.url, domains));
  const origins = [...new Set(tabs.map((tab) => tab.url ? tabOriginPattern(tab.url) : null).filter(Boolean))] as string[];

  if (origins.length) {
    const grantedOrigins = await browser.permissions.request({ origins }).catch(() => false);
    if (!grantedOrigins) {
      return { indexedDB: {}, localStorage: {}, sessionStorage: {} };
    }
  }

  const localStorageByOrigin: Record<string, Record<string, string>> = {};
  const sessionStorageByOrigin: Record<string, Record<string, string>> = {};
  const indexedDBByOrigin: Record<string, Serializable> = {};

  for (const tab of tabs) {
    if (!tab.id) continue;
    const [injection] = await scripting.executeScript<PageAuthStorage>({
      target: { tabId: tab.id },
      func: collectPageAuthStorage,
    }).catch(() => []);
    const storage = injection?.result;
    if (!storage?.origin || storage.origin === 'null') continue;

    if (Object.keys(storage.localStorage || {}).length) {
      localStorageByOrigin[storage.origin] = storage.localStorage;
    }
    if (Object.keys(storage.sessionStorage || {}).length) {
      sessionStorageByOrigin[storage.origin] = storage.sessionStorage;
    }
    if (Object.keys(storage.indexedDB || {}).length) {
      indexedDBByOrigin[storage.origin] = storage.indexedDB;
    }
  }

  return {
    indexedDB: indexedDBByOrigin,
    localStorage: localStorageByOrigin,
    sessionStorage: sessionStorageByOrigin,
  };
}

async function buildPersonaSyncPayload(persona: Persona) {
  const authStorage = await collectOpenTabAuthStorage(persona);
  const geolocation = persona.settings.geolocation ?? await geolocationFromBrowser();
  const cookies = Object.values(persona.cookies || {}).flat().map(cookieForAuthJson);
  const viewportScale = Number(persona.settings.viewportScale || window.devicePixelRatio || 1);

  return {
    extension_persona_id: persona.id,
    name: persona.name,
    settings: {
      user_agent: persona.settings.userAgent || navigator.userAgent,
      viewport_size: toViewportSize(persona.settings.viewport || `${window.innerWidth}x${window.innerHeight}`),
      viewport_device_scale_factor: Number.isFinite(viewportScale) ? viewportScale : 1,
      language: persona.settings.language || navigator.language,
      timezone: persona.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      geolocation,
    },
    cookies_txt: formatCookiesAsNetscape(persona.cookies || {}),
    auth_json: {
      TYPE: 'auth',
      SOURCE: 'archivebox-browser-extension',
      extension_persona_id: persona.id,
      captured_at: new Date().toISOString(),
      user_agent: persona.settings.userAgent || navigator.userAgent,
      cookies,
      localStorage: authStorage.localStorage,
      sessionStorage: authStorage.sessionStorage,
      indexedDB: authStorage.indexedDB,
    },
  };
}

export async function syncPersonaToArchiveBox(persona: Persona): Promise<PersonaSyncResponse> {
  const config = await getConfig();
  const serverUrl = normalizeServerUrl(config.archivebox_server_url);
  if (!serverUrl) throw new Error(t("Server not configured"));
  if (!config.archivebox_api_key) throw new Error(t("API key required"));

  await requestServerHostPermission(serverUrl);
  const payload = await buildPersonaSyncPayload(persona);

  const response = await fetch(`${serverUrl}/api/v1/personas/sync`, {
    method: 'POST',
    headers: apiHeaders(config.archivebox_api_key),
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify(payload),
  });

  if (response.status === 404) {
    throw new Error(t("ArchiveBox server does not expose the 0.9 persona sync API."));
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `${response.status} ${response.statusText}`);
  }

  return await response.json() as PersonaSyncResponse;
}
