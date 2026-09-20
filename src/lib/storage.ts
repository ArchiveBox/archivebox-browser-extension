import { appConnection } from './appConnection';
import { activeServer, validateRegistry, defaultServerPolicy } from './server_registry';
import type { ConfigState, Persona, Snapshot, ServerConfiguration, ServerRegistry, ServerPolicy } from './types';
import { archiveBoxServerUrlMatches } from './archiveboxUrlExclusions';
import { uuidv7 } from './uuid';
import { migratePublishedStorage } from './storage_migration';

const defaultConfig: ConfigState = {
  schema_version: 1, servers: [], active_server_id: null, default_server_ids: [], server_policies: {},
  ui_language: 'auto',
  match_urls: '',
  exclude_urls: '',
  local_retention_ms: 2592000000,
  enable_auto_archive: false,
  save_screenshots_locally: false,
  save_mhtml_locally: false,
  save_singlefile_locally: false,
  singlefile_extension_id: '',
  tab_manager_plus_extension_id: '',
};

async function getServerRegistry(): Promise<ServerRegistry> {
  await migratePublishedStorage();
  const { server_registry } = await browser.storage.local.get('server_registry');
  if (server_registry) {
    validateRegistry(server_registry as ServerRegistry);
    return server_registry as ServerRegistry;
  }
  const registry: ServerRegistry = await appConnection() ?? {
    schema_version: 1,
    servers: [],
    active_server_id: null,
    default_server_ids: [],
  };
  validateRegistry(registry);
  return registry;
}

export async function getConfig(): Promise<ConfigState> {
  const registry = await getServerRegistry();
  const local = await browser.storage.local.get(Object.keys(defaultConfig));
  const config: ConfigState = {
    ...defaultConfig,
    ...Object.fromEntries(Object.keys(defaultConfig).filter((key) => key in local).map((key) => [key, local[key]])),
    ...registry,
  };
  if (!['auto', 'en', 'es', 'zh_CN'].includes(config.ui_language)
    || ![60000, 86400000, 2592000000, 7776000000, 'never'].includes(config.local_retention_ms)
    || [config.match_urls, config.exclude_urls, config.singlefile_extension_id, config.tab_manager_plus_extension_id].some((value) => typeof value !== 'string')
    || [config.enable_auto_archive, config.save_screenshots_locally, config.save_mhtml_locally, config.save_singlefile_locally].some((value) => typeof value !== 'boolean')) {
    throw new Error('Saved extension settings are invalid.');
  }
  return config;
}

export async function setConfig(config: Partial<ConfigState>): Promise<void> {
  // Global capture/UI settings are independent of server registry edits.
  const { schema_version, servers, active_server_id, default_server_ids, server_policies, ...preferences } = config;
  if (server_policies !== undefined || servers !== undefined || active_server_id !== undefined || default_server_ids !== undefined || schema_version !== undefined) {
    throw new Error('Use server registry operations to change destinations.');
  }
  await browser.storage.local.set(preferences);
}

export async function updateServer(id: string | null, patch: Partial<Omit<ServerConfiguration, 'id'>> & { policy?: Partial<ServerPolicy> }): Promise<ServerConfiguration> {
  const current = await getServerRegistry();
  return navigator.locks.request('archivebox-server-registry', async () => {
    const { server_registry, server_policies = {} } = await browser.storage.local.get(['server_registry', 'server_policies']);
    const policies = server_policies as Record<string, ServerPolicy>;
    const registry = structuredClone((server_registry || current) as ServerRegistry);
    const original = registry.servers.find((item) => item.id === id);
    if (id && !original) throw new Error('This server profile was removed. Reload settings before editing it.');
    const normalizedAddress = patch.server === undefined ? undefined : new URL(patch.server.trim()).origin;
    const addressChanged = normalizedAddress !== undefined && normalizedAddress !== original?.server;
    const previous = addressChanged ? registry.servers.find((item) => item.server === normalizedAddress) : original;
    const { policy, ...fields } = patch;
    if (previous && Object.keys(fields).length === 0) {
      await browser.storage.local.set({ server_policies: {
        ...policies, [previous.id]: { ...defaultServerPolicy, ...policies[previous.id], ...policy },
      } });
      return previous;
    }
    const server: ServerConfiguration = {
      id: previous?.id || crypto.randomUUID(), name: '', server: '', token: '', persona: null,
      ...previous, ...fields,
    };
    server.server = normalizedAddress ?? server.server;
    server.name = patch.name ?? previous?.name ?? new URL(server.server).hostname;
    const index = registry.servers.findIndex((item) => item.id === server.id);
    if (index < 0) registry.servers.push(server); else registry.servers[index] = server;
    // Current single-destination configuration screen explicitly edits its submission destination.
    if (!previous || addressChanged) {
      registry.active_server_id = server.id;
      registry.default_server_ids = [server.id];
    }
    validateRegistry(registry);
    const nextPolicy = { ...defaultServerPolicy, ...policies[server.id], ...policy };
    await browser.storage.local.set({ server_registry: registry, server_policies: { ...policies, [server.id]: nextPolicy } });
    return server;
  });
}

export async function removeServer(id: string): Promise<void> {
  const current = await getServerRegistry();
  await navigator.locks.request('archivebox-server-registry', async () => {
    const stored = await browser.storage.local.get(['server_registry', 'server_policies']);
    const registry = structuredClone((stored.server_registry ?? current) as ServerRegistry);
    registry.servers = registry.servers.filter((server) => server.id !== id);
    registry.default_server_ids = registry.default_server_ids.filter((value) => value !== id);
    if (registry.active_server_id === id) registry.active_server_id = registry.servers[0]?.id ?? null;
    const server_policies = { ...stored.server_policies as Record<string, ServerPolicy> };
    delete server_policies[id];
    validateRegistry(registry);
    await browser.storage.local.set({ server_registry: registry, server_policies });
  });
}

export async function getArchiveBoxServerUrl(): Promise<string> {
  return activeServer(await getConfig())?.server || '';
}

export async function getSnapshots(): Promise<Snapshot[]> {
  await migratePublishedStorage();
  const { entries = [] } = await browser.storage.local.get('entries');
  return filterConfiguredArchiveBoxSnapshots(Array.isArray(entries) ? entries : []);
}

// All read/modify/write operations share a cross-context lock, including TTL cleanup.
export async function mutateSnapshots(update: (entries: Snapshot[]) => Snapshot[] | Promise<Snapshot[]>): Promise<Snapshot[]> {
  await migratePublishedStorage();
  return navigator.locks.request('archivebox-snapshots', async () => {
    const { entries = [] } = await browser.storage.local.get('entries');
    const current: Snapshot[] = Array.isArray(entries) ? entries as Snapshot[] : [];
    const previous_snapshots = new Map(current.map((entry) => [entry.id, entry]));
    const existingIds = new Set(current.map((entry) => entry.id));
    const updated = await update(current);
    const { server_policies } = await getConfig();
    const next = updated.map((snapshot) => {
      const previous = previous_snapshots.get(snapshot.id);
      if (!previous || !snapshot.remote_copies) return snapshot;
      const changed = (kind: 'screenshot' | 'mhtml' | 'singlefile') => snapshot[kind]
        && JSON.stringify(previous[kind]) !== JSON.stringify(snapshot[kind]);
      if (!changed('screenshot') && !changed('mhtml') && !changed('singlefile')) return snapshot;
      const remote_copies = Object.fromEntries(Object.entries(snapshot.remote_copies).map(([id, copy]) => {
        const policy = { ...defaultServerPolicy, ...server_policies[id] };
        const pending = (changed('screenshot') && policy.upload_screenshots_to_server)
          || (changed('mhtml') && policy.upload_mhtml_to_server)
          || (changed('singlefile') && policy.upload_singlefile_to_server);
        return [id, pending ? { ...copy, status: 'accepted' as const } : copy];
      }));
      return { ...snapshot, remote_copies };
    });
    const visible = await filterConfiguredArchiveBoxSnapshots(next);
    const visibleIds = new Set(visible.map((entry) => entry.id));
    // Exclusions reject new server URLs; they must not silently delete older,
    // unsent records just because cleanup updated a different snapshot.
    await browser.storage.local.set({ entries: next.filter((entry) => existingIds.has(entry.id) || visibleIds.has(entry.id)) });
    return visible;
  });
}

async function filterConfiguredArchiveBoxSnapshots(entries: Snapshot[]): Promise<Snapshot[]> {
  const { servers } = await getConfig();
  return entries.filter((snapshot) => !servers.some((server) => server.server && archiveBoxServerUrlMatches(server.server, snapshot.url)));
}

export async function getPersonas(): Promise<{
  personas: Persona[];
  active_persona: string;
}> {
  await migratePublishedStorage();
  const { personas = [], active_persona = '' } = await browser.storage.local.get([
    'personas',
    'active_persona',
  ]);
  return {
    personas: Array.isArray(personas) ? (personas as Persona[]) : [],
    active_persona: String(active_persona || ''),
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

export async function setActivePersona(active_persona: string): Promise<void> {
  await browser.storage.local.set({ active_persona });
}

export function defaultPersona(name: string): Persona {
  return {
    id: uuidv7(),
    name,
    created: new Date().toISOString(),
    last_used: null,
    cookies: {},
    settings: {},
  };
}

export async function ensurePersonas(): Promise<{
  personas: Persona[];
  active_persona: string;
}> {
  let { personas, active_persona } = await getPersonas();
  if (personas.length === 0) {
    personas = ['Private', 'Work', 'Anonymous'].map(defaultPersona);
    await setPersonas(personas);
  }
  if (!active_persona && personas[0]) {
    active_persona = personas[0].id;
    await setActivePersona(active_persona);
  }
  return { personas, active_persona };
}

export { defaultConfig };
