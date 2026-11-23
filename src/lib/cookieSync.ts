import { normalizeCookie } from './cookies';
import { syncPersonaToArchiveBox } from './personaSync';
import { getConfig, getPersonas, updatePersona } from './storage';
import type { Persona, StoredCookie, ServerConfiguration } from './types';
import { migratePublishedStorage } from './storage_migration';

const syncStatePrefix = 'cookie_sync:';
const syncAlarm = 'archivebox-cookie-sync';
const retryAlarmPrefix = `${syncAlarm}:`;
const retryDelayMs = 30_000;
const storageAlarmPrefix = 'archivebox-persona-storage:';
const storageSyncIntervalMs = 24 * 60 * 60 * 1000;
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type CookieSyncState = {
  server_id: string;
  persona_id: string;
  server_origin: string;
  domains: string[];
  retained_domains?: string[]; // Saved on this server, but no longer tracked in the browser.
  fingerprint: string;
  pending: boolean;
  enabled?: boolean;
  error?: string;
  last_synced_at?: string;
  indexeddb_attempted_at?: number;
  retry_count?: number;
  next_retry_at?: number;
};

async function getState(id: string): Promise<CookieSyncState | undefined> {
  return (await browser.storage.local.get(syncStatePrefix + id))[syncStatePrefix + id] as CookieSyncState | undefined;
}

export async function getCookieSyncStates(): Promise<Record<string, CookieSyncState>> {
  await migratePublishedStorage();
  const stored = await browser.storage.local.get(null);
  const states: Record<string, CookieSyncState> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(syncStatePrefix)) states[key.slice(syncStatePrefix.length)] = value as CookieSyncState;
  }
  return states;
}

async function saveState(id: string, state: CookieSyncState): Promise<void> {
  await browser.storage.local.set({ [syncStatePrefix + id]: state });
}

function serverOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

function cookieKey(cookie: StoredCookie): string {
  return JSON.stringify([cookie.domain, cookie.path, cookie.name]);
}

function mergeCookies(saved: StoredCookie[], current: StoredCookie[]): StoredCookie[] {
  const merged = new Map(saved.map((cookie) => [cookieKey(cookie), cookie]));
  for (const cookie of current) {
    const key = cookieKey(cookie);
    const previous = merged.get(key);
    // Retain equal objects, including their stored property order, so a
    // refresh cannot produce a spurious storage change and schedule itself.
    if (!previous || Object.entries(cookie).some(([field, value]) => previous[field as keyof StoredCookie] !== value)) {
      merged.set(key, cookie);
    }
  }
  return [...merged.values()];
}

async function fingerprint(cookies: Persona['cookies']): Promise<string> {
  const sorted = Object.entries(cookies).sort(([a], [b]) => a.localeCompare(b)).map(([domain, values]) => [
    domain, [...values].sort((a, b) => cookieKey(a).localeCompare(cookieKey(b))),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sorted)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Missing browser cookies are deliberately retained. Only removing a domain in
// the persona editor (or clearing its cookies) removes archived login data.
async function refreshCookies(id: string, domains: string[]): Promise<Persona | undefined> {
  if (!(await browser.permissions.contains({ permissions: ['cookies'] }))) {
    return (await getPersonas()).personas.find((persona) => persona.id === id);
  }
  const current = (await Promise.all(domains.map((domain) => browser.cookies.getAll({ domain: domain.replace(/^\./, '') })))).flat().map(normalizeCookie);
  return updatePersona(id, (persona) => {
    const cookies = { ...persona.cookies };
    for (const domain of domains) {
      if (!(domain in cookies)) continue;
      const matches = current.filter((cookie) => cookie.domain.replace(/^\./, '') === domain.replace(/^\./, ''));
      cookies[domain] = mergeCookies(cookies[domain] || [], matches);
    }
    return { ...persona, cookies };
  });
}

async function armRetry(id: string, state: CookieSyncState): Promise<void> {
  if (state.pending) {
    await browser.alarms.create(retryAlarmPrefix + id, { when: state.next_retry_at || Date.now() + retryDelayMs });
  }
}

async function recordFailure(id: string, state: CookieSyncState, error: unknown): Promise<void> {
  const retry_count = (state.retry_count || 0) + 1;
  const failed = {
    ...state, pending: true, retry_count,
    error: error instanceof Error ? error.message : String(error),
    next_retry_at: Date.now() + Math.min(retryDelayMs * 2 ** Math.min(retry_count - 1, 7), 60 * 60_000),
  };
  await saveState(id, failed);
  await armRetry(id, failed);
}

async function syncCookiesUnlocked(id: string, refresh: boolean, destination?: ServerConfiguration): Promise<boolean> {
  const state = await getState(id);
  if (!state || state.enabled === false || (refresh && !state.domains.length)) return false; // A successful manual sync is the consent boundary.
  const server = destination || (await getConfig()).servers.find((item) => item.id === state.server_id);
  if (!server || server.id !== state.server_id || serverOrigin(server.server) !== state.server_origin) return false;
  let persona: Persona | undefined;
  try {
    persona = refresh
      ? await refreshCookies(state.persona_id, state.domains)
      : (await getPersonas()).personas.find((item) => item.id === state.persona_id);
  } catch (error) {
    await recordFailure(id, state, error);
    throw error;
  }
  if (!persona) {
    await browser.storage.local.remove(syncStatePrefix + id);
    await browser.alarms.clear(retryAlarmPrefix + id);
    return false;
  }
  const domains = state.domains.filter((domain) => domain in persona.cookies);
  // The upload replaces remote cookies. Include saved domains even after their
  // browser cookies were cleared and their live-sync subscription stopped.
  const retained_domains = (state.retained_domains || []).filter(domain => domain in persona.cookies);
  const savedDomains = [...domains, ...retained_domains];
  const cookies = Object.fromEntries(savedDomains.map(domain => [domain, persona.cookies[domain] || []]));
  const nextFingerprint = await fingerprint(cookies);
  if (!state.pending && nextFingerprint === state.fingerprint) {
    if (domains.length !== state.domains.length || retained_domains.length !== (state.retained_domains || []).length) {
      await saveState(id, { ...state, domains, retained_domains });
    }
    return true;
  }
  const pending = { ...state, domains, retained_domains, pending: true, next_retry_at: Date.now() + retryDelayMs };
  await saveState(id, pending);
  // One-shot recovery if the worker is suspended during the upload.
  await armRetry(id, pending);
  try {
    await syncPersonaToArchiveBox(server, { ...persona, cookies }, state.server_origin);
    await saveState(id, { ...pending, fingerprint: nextFingerprint, pending: false, error: undefined,
      retry_count: 0, next_retry_at: undefined, last_synced_at: new Date().toISOString() });
    await browser.alarms.clear(retryAlarmPrefix + id);
    return true;
  } catch (error) {
    await recordFailure(id, pending, error);
    throw error;
  }
}

export async function syncPersonaCookies(server: ServerConfiguration, id: string): Promise<boolean> {
  return navigator.locks.request('archivebox-cookie-sync', () => syncCookiesUnlocked(`${server.id}:${id}`, true, server));
}

async function armStorageSync(id: string, state: CookieSyncState): Promise<void> {
  const name = storageAlarmPrefix + id;
  if (state.enabled === false) return void await browser.alarms.clear(name);
  // Existing profiles without an attempt timestamp keep their first scheduled
  // alarm across restarts rather than postponing it each time the worker wakes.
  if (!state.indexeddb_attempted_at && await browser.alarms.get(name)) return;
  await browser.alarms.create(name, {
    when: Math.max(Date.now() + 1000, (state.indexeddb_attempted_at || Date.now()) + storageSyncIntervalMs),
    periodInMinutes: storageSyncIntervalMs / 60_000,
  });
}

export async function disablePersonaCookieSync(serverId: string, personaId: string): Promise<void> {
  const id = `${serverId}:${personaId}`;
  await navigator.locks.request('archivebox-cookie-sync', async () => {
    const state = await getState(id);
    if (!state) return;
    clearTimeout(syncTimers.get(id));
    syncTimers.delete(id);
    await saveState(id, { ...state, enabled: false, pending: false, error: undefined, next_retry_at: undefined, retry_count: 0 });
    await browser.alarms.clear(retryAlarmPrefix + id);
    await browser.alarms.clear(storageAlarmPrefix + id);
  });
}

export async function syncPersonaManually(server: ServerConfiguration, persona_id: string, respectStorageInterval = false) {
  return navigator.locks.request('archivebox-cookie-sync', async () => {
    const origin = serverOrigin(server.server);
    const id = `${server.id}:${persona_id}`;
    const previous = await getState(id);
    if (respectStorageInterval) {
      if (!previous || previous.enabled === false || previous.server_origin !== origin) return { success: false, persona: undefined };
      if (previous.indexeddb_attempted_at && Date.now() - previous.indexeddb_attempted_at < storageSyncIntervalMs) {
        await armStorageSync(id, previous);
        return { success: true, persona: undefined };
      }
    }
    const original = (await getPersonas()).personas.find((persona) => persona.id === persona_id);
    if (!original) throw new Error('Persona not found');
    const persona = await refreshCookies(persona_id, respectStorageInterval ? previous!.domains : Object.keys(original.cookies));
    if (!persona) throw new Error('Persona not found');
    // An enabled profile's explicit edits extend its selected domains immediately.
    // Keep failed edits pending, so they use the existing worker recovery path.
    const pending = previous && previous.enabled !== false && previous.server_origin === origin
      ? { ...previous, domains: respectStorageInterval ? previous.domains : Object.keys(persona.cookies), pending: true, error: undefined, next_retry_at: Date.now() + retryDelayMs }
      : undefined;
    if (pending) {
      await saveState(id, pending);
      await armRetry(id, pending);
    }
    let response;
    try {
      response = await syncPersonaToArchiveBox(server, persona, origin);
    } catch (error) {
      if (pending) await recordFailure(id, pending, error);
      throw error;
    }
    await saveState(id, {
      server_id: server.id, persona_id, server_origin: origin,
      domains: respectStorageInterval ? previous!.domains : Object.keys(persona.cookies),
      retained_domains: respectStorageInterval ? previous!.retained_domains : undefined,
      fingerprint: await fingerprint(persona.cookies),
      pending: false,
      enabled: true,
      last_synced_at: new Date().toISOString(),
      indexeddb_attempted_at: previous?.server_origin === origin ? previous.indexeddb_attempted_at : undefined,
    });
    await browser.alarms.clear(retryAlarmPrefix + id);
    // Commit the lightweight sync before exporting or sending IndexedDB. A
    // storage failure must not mark cookies pending or start cookie retries.
    // Both requests use the original endpoint and full payload structure: older
    // servers replace auth.json instead of merging individual storage fields.
    const synced = (await getState(id))!;
    // Count attempts, not only successes: a rejected large upload must not be
    // retried on every cookie change or worker restart. Manual sync overrides it.
    const attempted = { ...synced, indexeddb_attempted_at: Date.now() };
    await saveState(id, attempted);
    await armStorageSync(id, attempted);
    const latest = (await getPersonas()).personas.find(item => item.id === persona_id);
    if (latest) {
      try {
        await syncPersonaToArchiveBox(server, latest, origin, true);
      } catch (error) {
        throw new Error(`Cookies and browser settings synced. IndexedDB sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return response;
  });
}

function scheduleUpload(id: string, state: CookieSyncState): void {
  if (syncTimers.has(id) || (state.retry_count && (state.next_retry_at || 0) > Date.now())) return;
  syncTimers.set(id, setTimeout(() => {
    syncTimers.delete(id);
    void navigator.locks.request('archivebox-cookie-sync', () => syncCookiesUnlocked(id, false)).catch(() => undefined);
  }, 500));
}

async function queueCookieChange(id: string, cookie: StoredCookie, removed: boolean): Promise<void> {
  await navigator.locks.request('archivebox-cookie-sync', async () => {
    const state = await getState(id);
    if (!state || state.enabled === false) return;
    const server = (await getConfig()).servers.find((item) => item.id === state.server_id);
    if (!server || state.server_origin !== serverOrigin(server.server)) return;
    const domain = cookie.domain.replace(/^\./, '');
    const selected = state.domains.filter((item) => item.replace(/^\./, '') === domain);
    if (!selected.length) return;
    if (removed) {
      const remaining = await browser.cookies.getAll({ domain });
      if (remaining.some(item => item.domain.replace(/^\./, '') === domain)) return;
      const domains = state.domains.filter(item => !selected.includes(item));
      // Browser deletion withdraws live sync, never the saved persona cookies.
      // With nothing left to track, quietly cancel any outstanding upload.
      if (!domains.length) {
        clearTimeout(syncTimers.get(id));
        syncTimers.delete(id);
        await browser.alarms.clear(retryAlarmPrefix + id);
      }
      await saveState(id, { ...state, domains, retained_domains: [...(state.retained_domains || []), ...selected], ...(!domains.length
        ? { pending: false, error: undefined, next_retry_at: undefined, retry_count: 0 }
        : {}) });
      return;
    }
    let changed = false;
    await updatePersona(state.persona_id, (persona) => {
      const cookies = { ...persona.cookies };
      for (const key of selected) {
        if (!(key in cookies)) continue;
        const previous = cookies[key] || [];
        const next = mergeCookies(previous, [cookie]);
        if (JSON.stringify(previous) !== JSON.stringify(next)) changed = true;
        cookies[key] = next;
      }
      return { ...persona, cookies };
    });
    if (!changed) return;
    const pending = { ...state, pending: true, next_retry_at: state.next_retry_at || Date.now() + retryDelayMs };
    await saveState(id, pending);
    await armRetry(id, pending);
    scheduleUpload(id, pending);
  });
}

export function configureCookieSync(): void {
  // Cache only the routing metadata; unrelated cookie events do not read the
  // browser cookie jar or repeatedly deserialize all saved persona cookies.
  let routing: Promise<Record<string, CookieSyncState>> | undefined;
  const getRouting = () => routing ||= getCookieSyncStates();
  const catchUp = async () => {
    for (const [id, state] of Object.entries(await getRouting())) {
      if (state.enabled === false) continue;
      await armStorageSync(id, state);
      if (state.pending && (state.next_retry_at || 0) > Date.now()) await armRetry(id, state);
      else await navigator.locks.request('archivebox-cookie-sync', () => syncCookiesUnlocked(id, true)).catch(() => undefined);
    }
  };
  const onCookieChanged = (change: Browser.cookies.CookieChangeInfo) => {
    // Renewals emit a removal followed by the replacement cookie.
    if (change.removed && change.cause === 'overwrite') return;
    const domain = change.cookie.domain.replace(/^\./, '');
    void getRouting().then(async (states) => {
      for (const [id, state] of Object.entries(states)) {
        if (state.enabled !== false && state.domains.some((item) => item.replace(/^\./, '') === domain)) {
          await queueCookieChange(id, normalizeCookie(change.cookie), change.removed);
        }
      }
    }).catch(() => undefined);
  };
  const registerCookies = () => {
    if (browser.cookies && !browser.cookies.onChanged.hasListener(onCookieChanged)) {
      browser.cookies.onChanged.addListener(onCookieChanged);
    }
  };
  registerCookies();
  browser.permissions.onAdded.addListener(registerCookies);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(storageAlarmPrefix)) {
      const id = alarm.name.slice(storageAlarmPrefix.length);
      void (async () => {
        const state = await getState(id);
        if (!state || state.enabled === false) return;
        const server = (await getConfig()).servers.find(item => item.id === state.server_id);
        if (!server || state.server_origin !== serverOrigin(server.server)) return;
        await syncPersonaManually(server, state.persona_id, true);
      })().catch(error => console.warn('ArchiveBox: scheduled persona storage sync failed:', error));
      return;
    }
    if (!alarm.name.startsWith(retryAlarmPrefix)) return;
    const id = alarm.name.slice(retryAlarmPrefix.length);
    void navigator.locks.request('archivebox-cookie-sync', async () => {
      const state = await getState(id);
      if (!state?.pending) return;
      if ((state.next_retry_at || 0) > Date.now()) await armRetry(id, state);
      else await syncCookiesUnlocked(id, false);
    }).catch(() => undefined);
  });
  browser.runtime.onStartup.addListener(() => { void catchUp().catch(() => undefined); });
  browser.runtime.onInstalled.addListener(() => { void catchUp().catch(() => undefined); });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const stateChanges = Object.entries(changes).filter(([key]) => key.startsWith(syncStatePrefix));
    if (stateChanges.length && routing) {
      routing = routing.then((states) => {
        const next = { ...states };
        for (const [key, change] of stateChanges) {
          const id = key.slice(syncStatePrefix.length);
          if (change.newValue) next[id] = change.newValue as CookieSyncState;
          else delete next[id];
        }
        return next;
      });
    }
    // Only explicit persona cookie edits matter here; settings/status updates
    // and our own cookie refresh must not schedule another complete scan.
    if (changes.personas) {
      const oldPersonas = (changes.personas.oldValue || []) as Persona[];
      const nextPersonas = (changes.personas.newValue || []) as Persona[];
      for (const old of oldPersonas) {
        const next = nextPersonas.find((persona) => persona.id === old.id);
        if (next && Object.keys(old.cookies).some((domain) => !(domain in next.cookies))) {
          void getRouting().then(async (states) => {
            for (const [id, state] of Object.entries(states)) if (state.persona_id === old.id) {
              await navigator.locks.request('archivebox-cookie-sync', () => syncCookiesUnlocked(id, false)).catch(() => undefined);
            }
          });
        }
      }
    }
    if (changes.server_registry) {
      void getRouting().then(async (states) => {
        for (const [id, state] of Object.entries(states)) {
          if (state.pending) await navigator.locks.request('archivebox-cookie-sync', () => syncCookiesUnlocked(id, false)).catch(() => undefined);
        }
      });
    }
  });
}
