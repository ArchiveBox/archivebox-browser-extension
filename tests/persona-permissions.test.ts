import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from './helpers/archivebox';
import { launchExtension, waitForSavedSettings } from './helpers/extension';

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
