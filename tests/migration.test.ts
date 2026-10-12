import { expect, test, type Page } from '@playwright/test';
import { launchExtension, readSnapshots } from './helpers/extension';

type Chrome = typeof browser;

async function storage(page: Page, keys: string[]): Promise<Record<string, unknown>> {
  return page.evaluate(keys => (globalThis as typeof globalThis & { chrome: Chrome }).chrome.storage.local.get(keys), keys);
}

// Puts storage back to what a published version left behind, then restarts
// the extension so its first start runs the migrations for real.
async function restartWithLegacyStorage(page: Page, id: string, values: Record<string, unknown>): Promise<Page> {
  const context = page.context();
  const previous = context.serviceWorkers().find(worker => worker.url().includes(id));
  const restarted = context.waitForEvent('serviceworker', { predicate: worker => worker !== previous && worker.url().includes(id) });
  await page.evaluate(values => navigator.locks.request('archivebox-storage-migration', async () => {
    const api = (globalThis as typeof globalThis & { chrome: Chrome }).chrome;
    await api.storage.local.clear();
    await api.storage.local.set(values);
    api.runtime.reload();
  }), values).catch(() => undefined);
  await restarted;
  const next = await context.newPage();
  await next.goto(`chrome-extension://${id}/options.html`);
  return next;
}

test('published entries arrays move into SQLite once, with receipts and captures', async () => {
  const harness = await launchExtension();
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await expect(page.locator('.saved-url-count')).toBeVisible();
    const serverId = '00000000-0000-4000-8000-000000000001';
    const capturedAt = '2026-02-01T00:00:00.000Z';
    // Source pages use a different domain from the configured server; Saved
    // URLs intentionally hides the ArchiveBox deployment's own domain.
    const legacy = [
      { id: 'legacy-a', url: 'https://example.net/a', timestamp: '2026-01-01T00:00:00.000Z', title: 'A', tags: ['one', 'two'], depth: 0, favIconUrl: null,
        persona_overrides: { [serverId]: 'Work' },
        mhtml: { storage: 'opfs', path: 'snapshots/20260101/example.net/legacy-a/chrome_extension_mhtml/snapshot.mhtml', mimeType: 'multipart/related', capturedAt, size: 10 },
        remote_copies: { [serverId]: { status: 'complete', submitted_to: 'https://archive.example.com', submitted_at: capturedAt, snapshot_id: 'remote-a',
          artifacts: { mhtml: { status: 'uploaded', path: 'snapshots/20260101/example.net/legacy-a/chrome_extension_mhtml/snapshot.mhtml', captured_at: capturedAt } } } } },
      // Two snapshots of one URL are separate saves and both survive.
      { id: 'legacy-b', url: 'https://example.net/a', timestamp: '2026-01-02T00:00:00.000Z', title: 'A again', tags: [], depth: 1 },
      { id: 'legacy-c', url: 'https://example.org/c', timestamp: '2026-01-03T00:00:00.000Z', title: 'C', tags: ['two'] },
    ];
    const migrated = await restartWithLegacyStorage(page, harness.id, {
      storage_schema_version: 1, entries: legacy,
      server_registry: { schema_version: 1, servers: [{ id: serverId, name: 'archive', server: 'https://archive.example.com', token: '', persona: null }],
        active_server_id: serverId, default_server_ids: [serverId] },
    });
    await expect.poll(async () => (await storage(migrated, ['storage_schema_version'])).storage_schema_version).toBe(2);
    const stored = await storage(migrated, ['entries', 'entries_backup_v1']);
    expect(stored.entries).toBeUndefined();
    expect(stored.entries_backup_v1).toEqual({ entries: legacy });
    const snapshots = await readSnapshots(migrated);
    expect(snapshots.map(snapshot => snapshot.id)).toEqual(['legacy-a', 'legacy-b', 'legacy-c']);
    expect(snapshots[0]).toEqual({ ...legacy[0], created_by_username: 'system', favIconUrl: undefined } as never);
    expect(snapshots[1]).toMatchObject({ url: 'https://example.net/a', depth: 1, tags: [] });
    expect(snapshots[2]).toMatchObject({ tags: ['two'], depth: 0 });
    await expect(migrated.locator('.saved-url-table tbody tr')).toHaveCount(3);
    await expect(migrated.locator('.tags-panel')).toContainText('two2');

    // A second start does nothing: the migration ran once.
    const again = await restartWithLegacyStorage(migrated, harness.id, { storage_schema_version: 2, entries_backup_v1: stored.entries_backup_v1 });
    expect(await readSnapshots(again)).toHaveLength(3);
  } finally {
    await harness.close();
  }
});
