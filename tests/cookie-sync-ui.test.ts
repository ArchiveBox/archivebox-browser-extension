import { expect } from '@playwright/test';
import { test } from './helpers/archivebox';
import { launchExtension } from './helpers/extension';
import type { CookieSyncState } from '../src/lib/cookieSync';

test('sync controls report real uploads, sync added sites immediately, and persist disabling', async ({ archivebox }, testInfo) => {
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    const address = page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
    await address.fill(archivebox.server); await address.blur();
    const token = page.getByPlaceholder('... abcexamplekey1234 ...');
    await token.fill(archivebox.key); await token.blur();
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    const name = `Cookie sync ${Date.now()}`;
    page.once('dialog', dialog => dialog.accept(name));
    await page.getByRole('button', { name: 'New Profile', exact: true }).click();
    const autoSync = page.getByRole('checkbox', { name: 'Auto-sync', exact: true });
    await expect(autoSync).not.toBeChecked();
    await expect(page.getByText('Never synced', { exact: true })).toBeVisible();
    const requests: Array<{ auth_json: { cookies: Array<{ domain: string; name: string; value: string }> } }> = [];
    page.on('request', request => { if (request.url().endsWith('/api/v1/personas/sync') && request.method() === 'POST') requests.push(request.postDataJSON()); });
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(autoSync).toBeChecked();
    await expect(page.locator('.persona-sync-time time')).toBeVisible();
    const first = await page.locator('.persona-sync-time time').getAttribute('datetime');
    expect(requests).toHaveLength(1);
    const list = async () => (await archivebox.api('/api/v1/personas/personas')).items;
    await expect.poll(async () => (await list()).some((item: { name: string }) => item.name === name)).toBe(true);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', first!);
    expect(requests).toHaveLength(2);
    const second = await page.locator('.persona-sync-time time').getAttribute('datetime');
    await harness.context.addCookies([
      { name: 'login', value: 'selected-login', domain: 'accounts.google.com', path: '/', secure: true, httpOnly: true },
      { name: 'login', value: 'unrelated-login', domain: 'example.org', path: '/' },
    ]);
    await page.getByRole('button', { name: /^(Load Browser Cookies|Refresh cookies)$/ }).click();
    await page.getByRole('checkbox', { name: 'Select Google', exact: true }).check();
    await page.getByRole('button', { name: `Add to ${name}`, exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', second!);
    expect(requests).toHaveLength(3);
    expect(requests[2]!.auth_json.cookies).toEqual([expect.objectContaining({ domain: 'accounts.google.com', value: 'selected-login' })]);
    const synced = await page.locator('.persona-sync-time time').getAttribute('datetime');
    const state = () => page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const stored = await api.storage.local.get(null);
      return Object.entries(stored).find(([key]) => key.startsWith('cookie_sync:'))?.[1] as CookieSyncState;
    });
    await expect.poll(async () => (await state()).domains).toEqual(['accounts.google.com']);
    // The existing background listener updates the same visible timestamp.
    await harness.context.addCookies([{ name: 'login', value: 'renewed-login', domain: 'accounts.google.com', path: '/', secure: true, httpOnly: true }]);
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', synced!);
    await autoSync.uncheck();
    await expect.poll(async () => (await state()).enabled).toBe(false);
    const disabledTime = (await state()).last_synced_at;
    await page.getByRole('checkbox', { name: 'Select example.org', exact: true }).check();
    await page.getByRole('button', { name: `Add to ${name}`, exact: true }).click();
    await expect(page.getByText('Copied 1 domain cookies to ' + name, { exact: true })).toBeVisible();
    await expect(page.locator('.persona-identity')).toContainText('2 sites');
    await expect(page.locator('.persona-identity')).toContainText('2 cookies');
    expect(requests).toHaveLength(3);
    expect((await state()).last_synced_at).toBe(disabledTime);
    await page.reload();
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(autoSync).not.toBeChecked();
    await expect(page.locator('.persona-identity')).toContainText('2 sites');
    await expect(page.locator('.persona-sync-time time')).toHaveAttribute('datetime', disabledTime!);
    await autoSync.check();
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', disabledTime!);
    expect(requests).toHaveLength(4);
    expect(requests[3]!.auth_json.cookies.map(cookie => cookie.domain).sort()).toEqual(['accounts.google.com', 'example.org']);
    const beforeFailure = (await state()).last_synced_at;
    await harness.context.setOffline(true);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona .status.error')).toBeVisible();
    expect((await state()).pending).toBe(true);
    expect((await state()).last_synced_at).toBe(beforeFailure);
    await expect(page.locator('.persona-sync-time time')).toHaveAttribute('datetime', beforeFailure!);
    await harness.context.setOffline(false);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).not.toHaveAttribute('datetime', beforeFailure!);
    await expect(page.locator('.persona .status.error')).toHaveCount(0);
    expect((await state()).pending).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('cookies-synced.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({ path: testInfo.outputPath('cookies-synced-mobile.png'), fullPage: true });
  } finally { await harness.close(); }
});
