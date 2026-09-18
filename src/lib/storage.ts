import { appConnection } from './appConnection';
import type { ConfigState, Persona, Snapshot } from './types';
import { archiveBoxServerUrlMatches } from './archiveboxUrlExclusions';
import { uuidv7 } from './uuid';

const defaultConfig: ConfigState = {
  archivebox_server_url: '',
  archivebox_api_key: '',
  ui_language: 'auto',
  match_urls: '',
  exclude_urls: '',
  local_retention_ms: 2592000000,
  enable_auto_archive: false,
  save_screenshots_locally: false,
  save_mhtml_locally: false,
  upload_screenshots_to_server: false,
  upload_mhtml_to_server: false,
  save_singlefile_locally: false,
  singlefile_extension_id: '',
  tab_manager_plus_extension_id: '',
};

export async function getConfig(): Promise<ConfigState> {
  const local = await browser.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key',
    'ui_language',
    'match_urls',
    'exclude_urls',
    'local_retention_ms',
    'enable_auto_archive',
    'save_screenshots_locally',
    'save_mhtml_locally',
    'upload_screenshots_to_server',
    'upload_mhtml_to_server',
    'save_singlefile_locally',
    'singlefile_extension_id',
    'tab_manager_plus_extension_id',
  ]);
  const sync = await browser.storage.sync.get(['config_archiveBoxBaseUrl']);
  // Keep each server/key pair together: never mix a manual server with an app token.
  const manual = local.archivebox_server_url || local.archivebox_api_key || sync.config_archiveBoxBaseUrl;
  const connection = manual ? undefined : await appConnection();

  return {
    archivebox_server_url: String(
      local.archivebox_server_url || sync.config_archiveBoxBaseUrl || connection?.server || '',
    ),
    archivebox_api_key: String(manual ? local.archivebox_api_key || '' : connection?.token || ''),
    ui_language: ['auto', 'en', 'es', 'zh_CN'].includes(String(local.ui_language))
      ? local.ui_language as ConfigState['ui_language']
      : 'auto',
    match_urls: typeof local.match_urls === 'string' ? local.match_urls : '',
    exclude_urls: typeof local.exclude_urls === 'string' ? local.exclude_urls : '',
    local_retention_ms: [60000, 86400000, 2592000000, 7776000000, 'never'].includes(local.local_retention_ms as number | string)
      ? local.local_retention_ms as ConfigState['local_retention_ms'] : defaultConfig.local_retention_ms,
    enable_auto_archive: Boolean(local.enable_auto_archive),
    save_screenshots_locally: Boolean(local.save_screenshots_locally),
    save_mhtml_locally: Boolean(local.save_mhtml_locally),
    upload_screenshots_to_server: Boolean(local.upload_screenshots_to_server),
    upload_mhtml_to_server: Boolean(local.upload_mhtml_to_server),
    save_singlefile_locally: Boolean(local.save_singlefile_locally),
    singlefile_extension_id: String(local.singlefile_extension_id || ''),
    tab_manager_plus_extension_id: String(local.tab_manager_plus_extension_id || ''),
  };
}

export async function setConfig(config: Partial<ConfigState>): Promise<void> {
  await navigator.locks.request('archivebox-snapshots', async () => {
    const nextConfig: Partial<ConfigState> = { ...config };
    if ('archivebox_server_url' in config || 'archivebox_api_key' in config) {
      const current = await getConfig();
      nextConfig.archivebox_server_url = config.archivebox_server_url ?? current.archivebox_server_url;
      nextConfig.archivebox_api_key = config.archivebox_api_key ??
        (nextConfig.archivebox_server_url === current.archivebox_server_url ? current.archivebox_api_key : '');
      if (!nextConfig.archivebox_server_url) {
        nextConfig.archivebox_api_key = '';
        await browser.storage.sync.remove('config_archiveBoxBaseUrl');
      }
    }
    if (typeof nextConfig.archivebox_server_url === 'string') {
      nextConfig.archivebox_server_url = nextConfig.archivebox_server_url.replace(/\/$/, '');
    }
    await browser.storage.local.set(nextConfig);
  });
}

export async function getArchiveBoxServerUrl(): Promise<string> {
  return (await getConfig()).archivebox_server_url;
}

export async function getSnapshots(): Promise<Snapshot[]> {
  const { entries = [] } = await browser.storage.local.get('entries');
  return filterConfiguredArchiveBoxSnapshots(Array.isArray(entries) ? (entries as Snapshot[]) : []);
}

// All read/modify/write operations share a cross-context lock, including TTL cleanup.
export async function mutateSnapshots(update: (entries: Snapshot[]) => Snapshot[] | Promise<Snapshot[]>): Promise<Snapshot[]> {
  return navigator.locks.request('archivebox-snapshots', async () => {
    const { entries = [] } = await browser.storage.local.get('entries');
    const current = Array.isArray(entries) ? entries as Snapshot[] : [];
    const existingIds = new Set(current.map((entry) => entry.id));
    const next = await update(current);
    const visible = await filterConfiguredArchiveBoxSnapshots(next);
    const visibleIds = new Set(visible.map((entry) => entry.id));
    // Exclusions reject new server URLs; they must not silently delete older,
    // unsent records just because cleanup updated a different snapshot.
    await browser.storage.local.set({ entries: next.filter((entry) => existingIds.has(entry.id) || visibleIds.has(entry.id)) });
    return visible;
  });
}

async function filterConfiguredArchiveBoxSnapshots(entries: Snapshot[]): Promise<Snapshot[]> {
  const serverUrl = await getArchiveBoxServerUrl();
  if (!serverUrl) return entries;
  return entries.filter((snapshot) => !archiveBoxServerUrlMatches(serverUrl, snapshot.url));
}

export async function getPersonas(): Promise<{
  personas: Persona[];
  activePersona: string;
}> {
  const { personas = [], activePersona = '' } = await browser.storage.local.get([
    'personas',
    'activePersona',
  ]);
  return {
    personas: Array.isArray(personas) ? (personas as Persona[]) : [],
    activePersona: String(activePersona || ''),
  };
}

export async function setPersonas(personas: Persona[]): Promise<void> {
  await browser.storage.local.set({ personas });
}

export async function mutatePersonas(update: (personas: Persona[]) => Persona[]): Promise<Persona[]> {
  return navigator.locks.request('archivebox-personas', async () => {
    const current = (await getPersonas()).personas;
    const next = update(current);
    if (JSON.stringify(next) !== JSON.stringify(current)) await setPersonas(next);
    return next;
  });
}

export async function updatePersona(id: string, update: (persona: Persona) => Persona): Promise<Persona | undefined> {
  const personas = await mutatePersonas((items) => items.map((item) => item.id === id ? update(item) : item));
  return personas.find((item) => item.id === id);
}

export async function setActivePersona(activePersona: string): Promise<void> {
  await browser.storage.local.set({ activePersona });
}

export function defaultPersona(name: string): Persona {
  return {
    id: uuidv7(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    cookies: {},
    settings: {},
  };
}

export async function ensurePersonas(): Promise<{
  personas: Persona[];
  activePersona: string;
}> {
  let { personas, activePersona } = await getPersonas();
  if (personas.length === 0) {
    personas = ['Private', 'Work', 'Anonymous'].map(defaultPersona);
    await setPersonas(personas);
  }
  if (!activePersona && personas[0]) {
    activePersona = personas[0].id;
    await setActivePersona(activePersona);
  }
  return { personas, activePersona };
}

export { defaultConfig };
