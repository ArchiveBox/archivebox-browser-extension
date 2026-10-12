import { expect } from '@playwright/test';
import { test } from './helpers/archivebox';
import { launchExtension, readSnapshots, waitForSavedSettings } from './helpers/extension';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const anonymousPersona = process.env.CHROME_BIN?.includes('Brave') ? 'Anonymous Brave' : 'Anonymous Chrome';

for (const inspect of [true, false]) test(`persona defaults drive the popup and server (inspection permission: ${inspect})`, async ({ archivebox }, testInfo) => {
  const document = await readFile(new URL('./fixtures/auto-archive.html', import.meta.url));
  const source = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(document);
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  const harness = await launchExtension(inspect ? ['cookies', 'tabs', 'scripting', 'pageCapture'] : ['tabs'], ['<all_urls>']);
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(options.getByLabel('Default logged-in persona', { exact: true })).toHaveValue('Default');
    await expect(options.getByLabel('Default anonymous persona', { exact: true })).toHaveValue(anonymousPersona);
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await options.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await options.getByLabel('API Key', { exact: true }).blur();
    await waitForSavedSettings(options);
    await options.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
    await options.getByLabel('Save MHTML snapshots locally', { exact: true }).uncheck();
    await options.getByLabel('Default logged-in persona', { exact: true }).selectOption('Private');
    await waitForSavedSettings(options);
    await options.reload();
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(options.getByLabel('Default logged-in persona', { exact: true })).toHaveValue('Private');
    await expect(options.getByLabel('Default anonymous persona', { exact: true })).toHaveValue(anonymousPersona);
    await options.screenshot({ path: testInfo.outputPath('persona-defaults.png'), fullPage: true });
    await options.getByRole('button', { name: 'Cookies', exact: true }).click();
    await options.getByRole('tab', { name: anonymousPersona, exact: true }).click();
    await expect(options.getByRole('checkbox', { name: 'Auto-sync', exact: true })).not.toBeChecked();
    await expect(options.getByLabel('Profile name', { exact: true })).toHaveValue(anonymousPersona);
    const target = await harness.context.newPage();
    const popup = await harness.context.newPage();
    const save = async (path: string, expected: string) => {
      await target.goto(origin + path);
      await target.bringToFront();
      await popup.goto(`chrome-extension://${harness.id}/popup.html`);
      await expect(popup.getByRole('button', { name: 'Persona', exact: true })).toContainText(expected);
      await expect.poll(async () => {
        const snapshot = (await readSnapshots(options)).find(item => item.url === origin + path);
        const copy = Object.values(snapshot?.remote_copies || {})[0];
        return copy?.snapshot_id ? (await archivebox.api(`/api/v1/core/snapshot/${copy.snapshot_id}`)).persona : undefined;
      }).toBe(expected);
    };
    await save('/no-state', inspect ? anonymousPersona : 'Private');
    await popup.screenshot({ path: testInfo.outputPath('persona-popup.png') });
    if (!inspect) return;
    await popup.getByRole('button', { name: 'Persona', exact: true }).click();
    await expect(popup.getByRole('menuitem', { name: 'Private', exact: true })).toBeVisible();
    await popup.getByRole('menuitem', { name: 'Private', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Persona', exact: true })).toContainText('Private');
    await expect.poll(async () => Object.values((await readSnapshots(options)).find(item => item.url === origin + '/no-state')?.remote_copies || {})[0]?.persona).toBe('Private');
    await harness.context.addCookies([{ name: 'login', value: 'personal-account', url: origin, httpOnly: true }]);
    await save('/cookie', 'Private');
    await harness.context.clearCookies();
    await target.evaluate(() => localStorage.setItem('account', 'personal-account'));
    await save('/storage', 'Private');
    await target.evaluate(() => localStorage.clear());
    await save('/empty-again', anonymousPersona);
    await target.evaluate(() => sessionStorage.setItem('session', 'account'));
    await save('/session', 'Private');
    await target.evaluate(async () => {
      sessionStorage.clear();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('account');
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
    });
    await save('/indexeddb', 'Private');
    await target.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('account');
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      });
    });
    // Anonymous is an ordinary profile: opt in to syncing a fingerprint and only selected alternate-account cookies.
    const uploads: any[] = [];
    options.on('request', request => { if (request.url().endsWith('/api/v1/personas/sync')) uploads.push(request.postDataJSON()); });
    await options.locator('.persona-settings summary').click();
    await options.getByLabel('User Agent', { exact: true }).fill('ArchiveBox anonymous account');
    await options.getByLabel('User Agent', { exact: true }).blur();
    await harness.context.addCookies([
      { name: 'login', value: 'alternate-account', domain: 'accounts.google.com', path: '/', secure: true, httpOnly: true },
      { name: 'login', value: 'personal-account', domain: 'example.org', path: '/' },
    ]);
    await options.getByRole('button', { name: /^(Load Browser Cookies|Refresh cookies)$/ }).click();
    await options.getByRole('checkbox', { name: 'Select Google', exact: true }).check();
    await options.getByRole('button', { name: `Add to ${anonymousPersona}`, exact: true }).click();
    await options.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(options.locator('.persona-sync-time time')).toBeVisible();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].settings.user_agent).toBe('ArchiveBox anonymous account');
    expect(uploads[0].auth_json.cookies).toEqual([expect.objectContaining({ domain: 'accounts.google.com', value: 'alternate-account' })]);
    await expect(options.getByRole('checkbox', { name: 'Auto-sync', exact: true })).toBeChecked();
    // Background auto-archive follows the same detection and keeps browser artifacts local for anonymous captures.
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await options.getByLabel('Save MHTML snapshots locally', { exact: true }).click();
    await expect(options.getByLabel('Save MHTML snapshots locally', { exact: true })).toBeChecked();
    await options.locator('.field').filter({ has: options.getByText('Match URL regex', { exact: true }) }).locator('input').fill('/automatic$');
    await options.getByLabel('Enable automatic archiving', { exact: true }).click();
    await expect(options.getByLabel('Enable automatic archiving', { exact: true })).toBeChecked();
    await waitForSavedSettings(options);
    await target.goto(origin + '/automatic');
    await expect.poll(async () => {
      const snapshot = (await readSnapshots(options)).find(item => item.url === origin + '/automatic');
      return snapshot && { mhtml: !!snapshot.mhtml, tags: snapshot.tags, copy: Object.values(snapshot.remote_copies || {})[0] };
    }).toMatchObject({ mhtml: true, tags: ['auto-archived'], copy: { persona: anonymousPersona, status: 'complete' } });
    const snapshot = (await readSnapshots(options)).find(item => item.url === origin + '/automatic')!;
    const copy = Object.values(snapshot.remote_copies || {})[0]!;
    expect(copy.artifacts?.mhtml).toBeUndefined();
    expect((await archivebox.api(`/api/v1/core/snapshot/${copy.snapshot_id}`)).persona).toBe(anonymousPersona);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});
