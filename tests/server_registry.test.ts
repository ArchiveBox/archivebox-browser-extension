import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { activeServer, defaultServers, requireServer, validateRegistry } from '../src/lib/server_registry';
import type { ServerRegistry } from '../src/lib/types';

const fixture = (): ServerRegistry => JSON.parse(readFileSync(new URL('../docs/server_registry.example.json', import.meta.url), 'utf8'));

test('canonical registry keeps browsing and submission selections independent', () => {
  const registry = fixture();
  validateRegistry(registry);
  expect(Object.keys(registry)).toEqual(['schema_version', 'servers', 'active_server_id', 'default_server_ids']);
  expect(Object.keys(registry.servers[0]!)).toEqual(['id', 'name', 'server', 'token', 'persona']);
  expect(activeServer(registry)?.name).toBe('Work');
  expect(defaultServers(registry).map((server) => server.name)).toEqual(['Home']);
  const work = requireServer(registry, registry.active_server_id!);
  registry.servers[1] = { ...registry.servers[1]!, name: 'Office', token: 'rotated' };
  expect(requireServer(registry, work.id).token).toBe('rotated');
  expect(work.token).toBe('work-test-key'); // A request captures an immutable destination.
  expect(defaultServers(registry)[0]?.persona).toBeNull();
});

test('canonical registry rejects ambiguous identities and invalid references', () => {
  const registry = fixture();
  expect(() => validateRegistry({ ...registry, servers: [...registry.servers, registry.servers[0]!] })).toThrow();
  expect(() => validateRegistry({ ...registry, active_server_id: 'unknown' })).toThrow();
  expect(() => validateRegistry({ ...registry, default_server_ids: ['unknown'] })).toThrow();
  expect(() => validateRegistry({ ...registry, default_server_ids: [registry.servers[0]!.id, registry.servers[0]!.id] })).toThrow();
  expect(() => validateRegistry({ ...registry, schema_version: 2 } as unknown as ServerRegistry)).toThrow();
  expect(() => validateRegistry({ ...registry, servers: [{ ...registry.servers[0]!, id: 'derived-from-address' }] })).toThrow();
});
