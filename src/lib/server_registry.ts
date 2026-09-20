import type { ServerRegistry, ServerDestination, ServerPolicy } from './types';

export const defaultServerPolicy: ServerPolicy = { upload_screenshots_to_server: false, upload_mhtml_to_server: false, upload_singlefile_to_server: true };
type RegistryWithPolicies = ServerRegistry & { server_policies?: Record<string, ServerPolicy> };

export function activeServer(registry: RegistryWithPolicies): ServerDestination | undefined {
  const server = registry.servers.find((server) => server.id === registry.active_server_id);
  return server ? { ...server, policy: { ...defaultServerPolicy, ...registry.server_policies?.[server.id] } } : undefined;
}

export function requireServer(registry: RegistryWithPolicies, id: string): ServerDestination {
  const server = registry.servers.find((server) => server.id === id);
  if (!server?.server) throw new Error('Server not configured');
  return { ...server, policy: { ...defaultServerPolicy, ...registry.server_policies?.[server.id] } };
}

export function defaultServers(registry: RegistryWithPolicies): ServerDestination[] {
  return registry.default_server_ids.map((id) => requireServer(registry, id));
}

export function validateRegistry(registry: ServerRegistry): void {
  const ids = new Set(registry.servers.map((server) => server.id));
  const valid_server = (server: ServerRegistry['servers'][number]) => {
    try {
      const url = new URL(server.server);
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(server.id)
        && typeof server.name === 'string' && typeof server.token === 'string'
        && (server.persona === null || typeof server.persona === 'string')
        && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  if (registry.schema_version !== 1 || ids.size !== registry.servers.length
    || !registry.servers.every(valid_server)
    || (registry.active_server_id !== null && !ids.has(registry.active_server_id))
    || new Set(registry.default_server_ids).size !== registry.default_server_ids.length
    || registry.default_server_ids.some((id) => !ids.has(id))) {
    throw new Error('Saved server settings are invalid or from an unsupported version.');
  }
}
