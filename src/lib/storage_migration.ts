import { defaultServerPolicy, validateRegistry } from './server_registry';
import type { Persona, RemoteCopy, ServerRegistry, ServerPolicy, Snapshot } from './types';

type PublishedSnapshot = Snapshot & {
  archiveboxCrawlId?: string;
  archiveboxSnapshotId?: string;
  archiveboxSubmittedAt?: string;
  archiveboxSubmittedTo?: string;
};
type PublishedPersona = Persona & { lastUsed?: string | null; serverPersonaId?: string; serverPersonaUrl?: string };

function serverAddress(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/$/, '');
  } catch { return undefined; }
}

// Upgrade the published Chrome/Firefox schema once, before any new-schema writes.
// One storage.set publishes data and marker together; a suspended worker cannot
// expose a registry while entries/personas still use the old representation.
export async function migratePublishedStorage(): Promise<void> {
  await navigator.locks.request('archivebox-storage-migration', async () => {
    const marker = await browser.storage.local.get('storage_schema_version');
    if (marker.storage_schema_version === 1) return;
    if (marker.storage_schema_version !== undefined) throw new Error('Unsupported extension storage version.');
    const stored = await browser.storage.local.get(null);
    const sync = await browser.storage.sync.get('config_archiveBoxBaseUrl');
    const registry: ServerRegistry = stored.server_registry as ServerRegistry ?? {
      schema_version: 1, servers: [], active_server_id: null, default_server_ids: [],
    };
    const policies = { ...stored.server_policies as Record<string, ServerPolicy> };
    const personas = (Array.isArray(stored.personas) ? stored.personas : []) as PublishedPersona[];
    const active_persona = String(stored.active_persona ?? stored.activePersona ?? '');
    const selected_persona = personas.find((persona) => persona.id === active_persona);
    const address = serverAddress(stored.archivebox_server_url || sync.config_archiveBoxBaseUrl);
    const legacy_server = address ? registry.servers.find((server) => server.server === address) : undefined;
    let destination = legacy_server;
    if (!stored.server_registry && address) {
      destination = { id: crypto.randomUUID(), name: new URL(address).hostname, server: address,
        token: String(stored.archivebox_api_key || ''), persona: selected_persona?.name ?? null };
      registry.servers.push(destination);
      registry.active_server_id = destination.id;
      registry.default_server_ids = [destination.id];
      policies[destination.id] = { ...defaultServerPolicy,
        ...(selected_persona ? { local_persona_id: selected_persona.id } : {}),
        upload_screenshots_to_server: Boolean(stored.upload_screenshots_to_server),
        upload_mhtml_to_server: Boolean(stored.upload_mhtml_to_server),
      };
    }
    validateRegistry(registry);
    const entries = ((Array.isArray(stored.entries) ? stored.entries : []) as PublishedSnapshot[]).map((entry) => {
      const { archiveboxCrawlId, archiveboxSnapshotId, archiveboxSubmittedAt, archiveboxSubmittedTo, ...snapshot } = entry;
      if (!archiveboxCrawlId && !archiveboxSnapshotId && !archiveboxSubmittedAt && !archiveboxSubmittedTo) return snapshot;
      const address = serverAddress(archiveboxSubmittedTo);
      const matches = registry.servers.filter((server) => server.server === address);
      // Published versions recorded acceptance before metadata/uploads finished.
      // Do not infer upload completion or invent a remote ID from the local ID.
      const copy: RemoteCopy = { status: 'accepted', submitted_to: address ?? archiveboxSubmittedTo ?? '',
        ...(archiveboxCrawlId ? { crawl_id: archiveboxCrawlId } : {}),
        ...(archiveboxSnapshotId ? { snapshot_id: archiveboxSnapshotId } : {}),
        ...(archiveboxSubmittedAt ? { submitted_at: archiveboxSubmittedAt } : {}),
      };
      if (matches.length !== 1) return { ...snapshot, unassigned_remote_copy: copy };
      return { ...snapshot, remote_copies: { [matches[0]!.id]: copy, ...snapshot.remote_copies } };
    });
    const updates: Record<string, unknown> = { storage_schema_version: 1, entries, active_persona, server_policies: policies };
    // Do not shadow Safari's native registry on a new installation.
    if (stored.server_registry || destination) updates.server_registry = registry;
    updates.personas = personas.map((persona) => {
      const { lastUsed, serverPersonaId, serverPersonaUrl, ...current } = persona;
      const next = { ...current, last_used: current.last_used ?? lastUsed ?? null };
      if (!serverPersonaId && !serverPersonaUrl) return next;
      if (!serverPersonaId || !serverPersonaUrl) return { ...next, unassigned_remote_persona: {
        ...(serverPersonaId ? { id: serverPersonaId } : {}), ...(serverPersonaUrl ? { url: serverPersonaUrl } : {}),
      } };
      const origin = serverAddress(serverPersonaUrl)?.split('/').slice(0, 3).join('/');
      const matches = registry.servers.filter((server) => new URL(server.server).origin === origin);
      const reference = { id: serverPersonaId, url: serverPersonaUrl };
      return matches.length === 1
        ? { ...next, remote_personas: { [matches[0]!.id]: reference, ...next.remote_personas } }
        : { ...next, unassigned_remote_persona: reference };
    });
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith('cookieSync:') || !value || typeof value !== 'object') continue;
      const persona_id = key.slice('cookieSync:'.length);
      const state = value as Record<string, unknown>;
      const address = serverAddress(state.serverOrigin);
      const server_origin = address ? new URL(address).origin : undefined;
      const matches = registry.servers.filter((server) => new URL(server.server).origin === server_origin);
      if (matches.length !== 1 || !personas.some((persona) => persona.id === persona_id)) continue;
      const server_id = matches[0]!.id;
      const { serverOrigin, lastSyncedAt, retryCount, nextRetryAt, ...rest } = state;
      updates['cookie_sync:' + server_id + ':' + persona_id] = { ...rest, server_id, persona_id,
        server_origin, ...(lastSyncedAt !== undefined ? { last_synced_at: lastSyncedAt } : {}),
        ...(retryCount !== undefined ? { retry_count: retryCount } : {}),
        ...(nextRetryAt !== undefined ? { next_retry_at: nextRetryAt } : {}),
      };
    }
    await browser.storage.local.set(updates);
    // Retain unrecognized legacy connection/consent data for manual recovery.
    // Successfully mapped secrets have exactly one current authoritative copy.
    const obsolete = ['activePersona', ...Object.keys(stored).filter((key) => key.startsWith('cookieSync:')
      && Object.keys(updates).some((next) => next.startsWith('cookie_sync:') && next.endsWith(':' + key.slice('cookieSync:'.length))))];
    if (destination) obsolete.push('archivebox_server_url', 'archivebox_api_key', 'upload_screenshots_to_server', 'upload_mhtml_to_server');
    await browser.storage.local.remove(obsolete);
    if (destination) await browser.storage.sync.remove('config_archiveBoxBaseUrl');
  });
}
