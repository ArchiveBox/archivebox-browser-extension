import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from './helpers/archivebox';
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
    expect(uploads).toHaveLength(2);
    expect(uploads[1].auth_json.origins).toEqual(uploads[0].auth_json.origins);
    expect(uploads[1].auth_json.tabs).toEqual(uploads[0].auth_json.tabs);
    expect(uploads[1].auth_json.cookies).toEqual(uploads[0].auth_json.cookies);
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
    expect(uploads).toHaveLength(2);
    expect(uploads[1].auth_json.cookies).toEqual(uploads[0].auth_json.cookies);
    expect(uploads[1].auth_json.origins).toEqual(uploads[0].auth_json.origins);
    expect(uploads[1].auth_json.tabs).toEqual(uploads[0].auth_json.tabs);
    const synced = (await archivebox.api('/api/v1/personas/personas?limit=100')).items;
    expect(synced.find((persona: any) => persona.name === 'Private')).toBeTruthy();
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});

test('saving from the popup still archives while the persona cookie sync is failing', async ({ archivebox }) => {
  // Several origins on one host, all covered by the profile's 127.0.0.1 cookie domain.
  const sources = await Promise.all(Array.from({ length: 6 }, async () => {
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
    const target = await harness.context.newPage();
    await target.goto(`${origin}/signed-in`);
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
    const uploads: number[] = [];
    harness.context.on('response', response => { if (response.url().endsWith('/api/v1/personas/sync')) uploads.push(response.status()); });
    await options.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(options.locator('.persona-sync-time time')).toBeVisible();
    expect(uploads).toEqual([200]);

    // The sites now hold more browser storage than ArchiveBox accepts in one
    // request (25 MB), so every upload of this profile is rejected.
    for (const { origin: site } of sources) {
      const page = await harness.context.newPage();
      await page.goto(`${site}/storage`);
      await page.evaluate(() => localStorage.setItem('cache', 'x'.repeat(4_500_000)));
    }
    await harness.context.addCookies([{ name: 'login', value: 'refreshed-login', url: origin }]);

    const popup = await harness.context.newPage();
    await target.bringToFront();
    await popup.goto(`chrome-extension://${harness.id}/popup.html`);
    await expect(popup.getByRole('button', { name: 'Persona', exact: true })).toContainText('Private');
    await expect.poll(async () => {
      const snapshot = (await readSnapshots(options)).find(item => item.url === `${origin}/signed-in`);
      const copy = Object.values(snapshot?.remote_copies || {})[0];
      return copy?.snapshot_id ? (await archivebox.api(`/api/v1/core/snapshot/${copy.snapshot_id}`)).url : copy?.status;
    }, { timeout: 30_000 }).toBe(`${origin}/signed-in`);
    expect(uploads.length).toBeGreaterThan(1);
    expect(uploads.slice(1).every(status => status >= 400)).toBe(true);
    // The failed upload is still reported and retried in settings.
    await options.bringToFront();
    await expect(options.getByRole('status').filter({ hasText: 'Cookie sync failed; retrying automatically' })).toBeVisible();
  } finally {
    await harness.close();
    for (const { source } of sources) await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});
