import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test, withArchiveBox, type ArchiveBoxApi } from './helpers/archivebox';
import { launchExtension, readSnapshots, waitForSavedSettings } from './helpers/extension';

test('a discarded tab preserves saved browser storage without blocking persona sync', async ({ archivebox }) => {
  const document = await readFile(new URL('./fixtures/auto-archive.html', import.meta.url));
  const source = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(document);
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const url = `http://127.0.0.1:${address.port}/storage`;
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    const target = await harness.context.newPage();
    await target.goto(url);
    await target.evaluate(() => { localStorage.setItem('account', 'alternate-account'); sessionStorage.setItem('session', 'preserve-me'); });
    await harness.context.addCookies([{ name: 'login', value: 'selected-login', url }]);
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await page.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await page.getByLabel('API Key', { exact: true }).blur();
    await waitForSavedSettings(page);
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select 127.0.0.1', exact: true }).check();
    await page.getByRole('button', { name: 'Add to Private', exact: true }).click();
    const uploads: any[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/v1/personas/sync')) uploads.push(request.postDataJSON()); });
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
    expect(uploads).toHaveLength(2);
    expect(uploads[0].auth_json.origins[0]).not.toHaveProperty('indexedDB');
    const first = await page.locator('.persona-sync-time time').getAttribute('datetime');
    expect(uploads[0].auth_json.origins[0].localStorage).toContainEqual({ name: 'account', value: 'alternate-account' });
    expect(uploads[0].auth_json.tabs[0].sessionStorage).toContainEqual({ name: 'session', value: 'preserve-me' });
    await page.bringToFront();
    const discarded = await page.evaluate(async url => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const tab = (await api.tabs.query({})).find(tab => tab.url === url)!;
      return (await api.tabs.discard(tab.id!))?.discarded;
    }, url);
    expect(discarded).toBe(true);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', first!);
    await expect(page.locator('.persona .status.error')).toHaveCount(0);
    expect(uploads).toHaveLength(4);
    expect(uploads[2].auth_json.origins).toEqual(uploads[0].auth_json.origins);
    expect(uploads[2].auth_json.tabs).toEqual(uploads[0].auth_json.tabs);
    expect(uploads[2].auth_json.cookies).toEqual(uploads[0].auth_json.cookies);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});

// One open tab whose page the extension cannot read must not block uploading
// the profile's cookies. That tab's last saved browser storage is kept.
for (const [name, makeUnreadable] of [
  ['a matching tab showing an error page', async (harness: Awaited<ReturnType<typeof launchExtension>>, url: string) => {
    await expect((await harness.context.newPage()).goto(`${url}/error`)).rejects.toThrow(/ERR_HTTP_RESPONSE_CODE_FAILURE/);
  }],
  ['site access restricted in browser settings', async (harness: Awaited<ReturnType<typeof launchExtension>>) => {
    const extensions = await harness.context.newPage();
    await extensions.goto('chrome://extensions');
    // The real "Site access: On specific sites" control, keeping only the ArchiveBox server.
    await extensions.evaluate(async id => {
      const developer = (globalThis as typeof globalThis & { chrome: any }).chrome.developerPrivate;
      await developer.updateExtensionConfiguration({ extensionId: id, hostAccess: 'ON_SPECIFIC_SITES' });
      await developer.addHostPermission(id, 'http://localhost/*');
    }, harness.id);
    await extensions.close();
  }],
] as const) test(`${name} keeps saved browser storage without blocking persona sync`, async ({ archivebox }) => {
  const source = createServer((request, response) => {
    response.writeHead(request.url === '/error' ? 500 : 200, { 'Content-Type': 'text/html' });
    response.end(request.url === '/error' ? '' : '<p>signed in</p>');
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    const target = await harness.context.newPage();
    await target.goto(`${origin}/storage`);
    await target.evaluate(() => { localStorage.setItem('account', 'alternate-account'); sessionStorage.setItem('session', 'preserve-me'); });
    const second = await harness.context.newPage();
    await second.goto(`${origin}/second`);
    await second.evaluate(() => sessionStorage.setItem('session', 'second-tab'));
    await harness.context.addCookies([{ name: 'login', value: 'selected-login', url: origin }]);
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await page.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await page.getByLabel('API Key', { exact: true }).blur();
    await waitForSavedSettings(page);
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select 127.0.0.1', exact: true }).check();
    await page.getByRole('button', { name: 'Add to Private', exact: true }).click();
    const uploads: any[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/v1/personas/sync')) uploads.push(request.postDataJSON()); });
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
    expect(uploads).toHaveLength(2);
    expect(uploads[0].auth_json.origins[0]).not.toHaveProperty('indexedDB');
    const first = await page.locator('.persona-sync-time time').getAttribute('datetime');
    // Both tabs share the origin's localStorage, exported once; each keeps its own sessionStorage.
    expect(uploads[0].auth_json.origins).toHaveLength(1);
    expect(uploads[0].auth_json.origins[0].localStorage).toContainEqual({ name: 'account', value: 'alternate-account' });
    expect(uploads[0].auth_json.tabs).toEqual(expect.arrayContaining([
      { url: `${origin}/storage`, sessionStorage: [{ name: 'session', value: 'preserve-me' }] },
      { url: `${origin}/second`, sessionStorage: [{ name: 'session', value: 'second-tab' }] },
    ]));
    expect(uploads[0].auth_json.tabs).toHaveLength(2);

    await makeUnreadable(harness, origin);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
    await expect(page.locator('.persona .status.error')).toHaveCount(0);
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', first!);
    expect(uploads).toHaveLength(4);
    expect(uploads[2].auth_json.cookies).toEqual(uploads[0].auth_json.cookies);
    expect(uploads[2].auth_json.origins).toEqual(uploads[0].auth_json.origins);
    expect(uploads[2].auth_json.tabs).toEqual(uploads[0].auth_json.tabs);
    const synced = (await archivebox.api('/api/v1/personas/personas?limit=100')).items;
    expect(synced.find((persona: any) => persona.name === 'Private')).toBeTruthy();
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});


async function writeIndexedDB(page: Page, value: string | number) {
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('account', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(typeof value === 'number' ? 'x'.repeat(value) : value, 'login');
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, value);
}

async function syncState(page: Page) {
  return page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    const values = await api.storage.local.get(null);
    return {
      states: Object.entries(values).filter(([key]) => key.startsWith('cookie_sync:')).map(([, value]) => value as Record<string, any>),
      alarms: await api.alarms.getAll(),
    };
  });
}

for (const oversized of [false, true]) test(`cookies sync before ${oversized ? 'older-server rejected oversized' : 'successful'} IndexedDB without making cookie updates heavy`, async ({ archivebox: currentServer }) => {
  const run = async (archivebox: ArchiveBoxApi) => {
    const sources = await Promise.all(Array.from({ length: 1 }, async () => {
      const source = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Signed in</title><p>signed in</p>');
      });
      await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
      const address = source.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture port');
      return { source, origin: `http://127.0.0.1:${address.port}` };
    }));
    const { origin } = sources[0]!;
    const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
    try {
      // A real 30 MiB database exceeds the older server's actual 25 MB limit,
      // while remaining below Chrome's per-message limit. No API is intercepted.
      const targets: Page[] = [];
      for (const { origin: site } of sources) {
        const target = await harness.context.newPage();
        await target.goto(`${site}/signed-in`);
        await target.evaluate(() => { localStorage.setItem('account', 'light-account'); sessionStorage.setItem('session', 'light-session'); });
        await writeIndexedDB(target, oversized ? 30 * 1024 * 1024 : 'indexed-login');
        targets.push(target);
      }
      const target = targets[0]!;
      await harness.context.addCookies([{ name: 'login', value: 'first-login', url: origin }]);
      const options = await harness.context.newPage();
      await options.goto(`chrome-extension://${harness.id}/options.html`);
      await options.getByRole('button', { name: 'Configuration', exact: true }).click();
      await options.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
      await options.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
      await options.getByLabel('API Key', { exact: true }).fill(archivebox.key);
      await options.getByLabel('API Key', { exact: true }).blur();
      await options.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
      await options.getByLabel('Save MHTML snapshots locally', { exact: true }).uncheck();
      await options.getByLabel('Default logged-in persona', { exact: true }).selectOption('Private');
      await waitForSavedSettings(options);
      await options.getByRole('button', { name: 'Cookies', exact: true }).click();
      await options.getByRole('tab', { name: 'Private', exact: true }).click();
      await options.getByRole('checkbox', { name: 'Select 127.0.0.1', exact: true }).check();
      await options.getByRole('button', { name: 'Add to Private', exact: true }).click();
      const uploads: { bytes: number; payload?: any; status?: number }[] = [];
      harness.context.on('request', request => {
        if (!request.url().endsWith('/api/v1/personas/sync')) return;
        const bytes = request.postDataBuffer()?.length || 0;
        // Do not parse or retain the deliberately oversized body in the runner.
        uploads.push({ bytes, payload: bytes < 1_000_000 ? request.postDataJSON() : undefined });
      });
      harness.context.on('response', response => {
        if (!response.url().endsWith('/api/v1/personas/sync')) return;
        const upload = uploads.find(item => item.status === undefined)!;
        upload.status = response.status();
      });
      if (!archivebox.collection) throw new Error('This persistence regression requires ARCHIVEBOX_TEST_COLLECTION with an external test server');
      const serverAuth = async () => JSON.parse(await readFile(path.join(archivebox.collection!, 'personas', 'Private', 'auth.json'), 'utf8'));
      await options.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect.poll(() => uploads[0]?.status).toBe(200);
      expect(uploads[0]!.payload.auth_json.origins).toHaveLength(sources.length);
      for (const saved of uploads[0]!.payload.auth_json.origins) {
        expect(saved).not.toHaveProperty('indexedDB');
        expect(saved.localStorage).toEqual([{ name: 'account', value: 'light-account' }]);
      }
      expect(uploads[0]!.payload.auth_json.tabs).toHaveLength(sources.length);
      expect(uploads[0]!.payload.settings.user_agent).toBeTruthy();
      expect((await serverAuth()).cookies).toContainEqual(expect.objectContaining({ name: 'login', value: 'first-login' }));
      await expect(options.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
      expect(uploads).toHaveLength(2);
      const completed = await syncState(options);
      expect(completed.states).toHaveLength(1);
      expect(completed.states[0]).toMatchObject({ pending: false, enabled: true });
      expect(completed.states[0]!.error).toBeUndefined();
      expect(completed.states[0]!.next_retry_at).toBeUndefined();
      const storageAlarm = completed.alarms.filter(alarm => alarm.name.startsWith('archivebox-persona-storage:'));
      expect(storageAlarm).toHaveLength(1);
      expect(storageAlarm[0]!.periodInMinutes).toBe(24 * 60);
      expect(storageAlarm[0]!.scheduledTime).toBe(completed.states[0]!.indexeddb_attempted_at + 24 * 60 * 60 * 1000);
      expect(completed.alarms.filter(alarm => alarm.name.startsWith('archivebox-cookie-sync:'))).toEqual([]);
      if (oversized) {
        expect(uploads[1]!.bytes).toBeGreaterThan(25 * 1024 * 1024);
        expect(uploads[1]!.status).toBe(503); // Pinned older API maps RequestDataTooBig to 503.
        await expect(options.locator('.status.error').filter({ hasText: 'Cookies and browser settings synced. IndexedDB sync failed' })).toContainText('RequestDataTooBig:');
      } else {
        expect(uploads[1]!.status).toBe(200);
        expect(uploads[1]!.payload.cookies_txt).toBe(uploads[0]!.payload.cookies_txt);
        expect(uploads[1]!.payload.auth_json.cookies).toEqual(uploads[0]!.payload.auth_json.cookies);
        expect(uploads[1]!.payload.auth_json.tabs).toEqual(uploads[0]!.payload.auth_json.tabs);
        expect(uploads[1]!.payload.auth_json.origins[0].localStorage).toEqual(uploads[0]!.payload.auth_json.origins[0].localStorage);
        const database = uploads[1]!.payload.auth_json.origins[0].indexedDB[0];
        expect(database).toMatchObject({ name: 'account', version: 1, stores: [{ name: 'sessions', keyPath: null, autoIncrement: false, indexes: [] }] });
        expect(JSON.parse(database.data).data.data[0].rows).toEqual([{ $: ['login', 'indexed-login'], $types: { $: { '': 'arrayNonindexKeys' } } }]);
        expect((await serverAuth()).origins.find((entry: any) => entry.origin === origin).indexedDB).toEqual([database]);
      }
      // A site changing IndexedDB must not generate an upload per mutation.
      await writeIndexedDB(target, 'changed-indexed-login');
      await target.waitForTimeout(1200); // Observe beyond the real 500 ms cookie debounce.
      expect(uploads).toHaveLength(2);
      await harness.context.addCookies([{ name: 'login', value: 'refreshed-login', url: origin }]);
      await expect.poll(() => uploads.length).toBe(3);
      await expect.poll(() => uploads[2]?.status).toBe(200);
      for (const saved of uploads[2]!.payload.auth_json.origins) expect(saved).not.toHaveProperty('indexedDB');
      expect((await serverAuth()).cookies).toContainEqual(expect.objectContaining({ name: 'login', value: 'refreshed-login' }));
      if (!oversized) expect((await serverAuth()).origins.find((entry: any) => entry.origin === origin).indexedDB)
        .toEqual(uploads[1]!.payload.auth_json.origins[0].indexedDB);
      expect((await syncState(options)).states[0]).toMatchObject({ pending: false, enabled: true, indexeddb_attempted_at: completed.states[0]!.indexeddb_attempted_at });
      if (!oversized) {
        // Deliver the real browser alarm early. The persisted attempt time must
        // prevent another heavy export, then restore the normal daily schedule.
        await options.evaluate(async name => {
          const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
          await api.alarms.create(name, { when: Date.now() + 1000 });
        }, storageAlarm[0]!.name);
        await expect.poll(async () => (await syncState(options)).alarms.find(alarm => alarm.name === storageAlarm[0]!.name)?.scheduledTime)
          .toBe(storageAlarm[0]!.scheduledTime);
        expect(uploads).toHaveLength(3);
        expect((await syncState(options)).states[0]!.indexeddb_attempted_at).toBe(completed.states[0]!.indexeddb_attempted_at);
        // An explicit user sync can still export changed IndexedDB immediately.
        await options.getByRole('button', { name: 'Sync now', exact: true }).click();
        await expect(options.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
        expect(uploads).toHaveLength(5);
        expect(uploads.slice(3).map(upload => upload.status)).toEqual([200, 200]);
        expect(JSON.parse(uploads[4]!.payload.auth_json.origins[0].indexedDB[0].data).data.data[0].rows[0].$)
          .toEqual(['login', 'changed-indexed-login']);
        expect((await serverAuth()).origins.find((entry: any) => entry.origin === origin).indexedDB)
          .toEqual(uploads[4]!.payload.auth_json.origins[0].indexedDB);
      }
      // Popup archiving remains usable after either outcome.
      const popup = await harness.context.newPage();
      await target.bringToFront();
      await popup.goto(`chrome-extension://${harness.id}/popup.html`);
      await expect(popup.getByRole('button', { name: 'Persona', exact: true })).toContainText('Private');
      await expect.poll(async () => {
        const snapshot = (await readSnapshots(options)).find(item => item.url === `${origin}/signed-in`);
        const copy = Object.values(snapshot?.remote_copies || {})[0];
        return copy?.snapshot_id ? (await archivebox.api(`/api/v1/core/snapshot/${copy.snapshot_id}`)).url : copy?.status;
      }, { timeout: 30_000 }).toBe(`${origin}/signed-in`);
    } finally {
      await harness.close();
      for (const { source } of sources) await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
    }
  };
  if (oversized) await withArchiveBox(run, fileURLToPath(new URL('./archivebox-server-legacy', import.meta.url)));
  else await run(currentServer);
});
