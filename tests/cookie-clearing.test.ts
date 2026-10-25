import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from './helpers/archivebox';
import { launchExtension, waitForSavedSettings } from './helpers/extension';
import type { CookieSyncState } from '../src/lib/cookieSync';
import type { Persona } from '../src/lib/types';

test('clearing browser cookies stops their sync without deleting saved persona cookies', async ({ archivebox }) => {
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    await harness.context.addCookies([
      { name: 'login', value: 'saved-login', domain: '.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' },
      { name: 'preferences', value: 'saved-preferences', domain: '.google.com', path: '/' },
      { name: 'login', value: 'other-login', domain: 'example.org', path: '/' },
    ]);
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await page.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await page.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await page.getByLabel('API Key', { exact: true }).blur();
    await waitForSavedSettings(page);
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    const name = `Cookie clearing ${Date.now()}`;
    page.once('dialog', dialog => dialog.accept(name));
    await page.getByRole('button', { name: 'New Profile', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select all visible cookie domains', exact: true }).check();
    await page.getByRole('button', { name: `Add to ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(page.locator('.persona-sync-time time')).toBeVisible();
    const stored = () => page.evaluate(async name => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const values = await api.storage.local.get(null);
      const persona = (values.personas as Persona[]).find(persona => persona.name === name)!;
      const state = Object.entries(values).find(([key, value]) => key.startsWith('cookie_sync:')
        && (value as CookieSyncState).persona_id === persona.id)![1] as CookieSyncState;
      return { persona, state, alarms: await api.alarms.getAll() };
    }, name);
    const initial = await stored();
    expect(initial.state.domains.sort()).toEqual(['example.org', 'google.com']);
    const serverCookies = async () => archivebox.collection
      ? JSON.parse(await readFile(path.join(archivebox.collection, 'personas', name, 'auth.json'), 'utf8')).cookies
      : undefined;
    const originalRemoteCookies = await serverCookies();
    if (archivebox.collection) expect(originalRemoteCookies).toHaveLength(3);

    // Chrome reports a removal before replacing a cookie; renewing a login must keep syncing.
    await harness.context.addCookies([{ name: 'login', value: 'renewed-login', domain: '.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await expect.poll(async () => (await stored()).state.last_synced_at).not.toBe(initial.state.last_synced_at);
    expect((await stored()).state.domains.sort()).toEqual(['example.org', 'google.com']);
    const renewed = await stored();
    const renewedRemoteCookies = await serverCookies();
    if (archivebox.collection) expect(renewedRemoteCookies).toContainEqual(expect.objectContaining({ value: 'renewed-login', secure: true, httpOnly: true, sameSite: 'strict' }));

    // Removing one cookie keeps the domain active while others remain.
    await harness.context.clearCookies({ domain: '.google.com', name: 'preferences' });
    await harness.context.addCookies([{ name: 'login', value: 'other-renewed', domain: 'example.org', path: '/' }]);
    await expect.poll(async () => (await stored()).state.last_synced_at).not.toBe(renewed.state.last_synced_at);
    expect((await stored()).state.domains).toContain('google.com');
    const beforeClear = await stored();
    await harness.context.clearCookies({ domain: '.google.com' });
    await expect.poll(async () => (await stored()).state.domains).toEqual(['example.org']);
    await expect(page.getByRole('checkbox', { name: 'Select Google', exact: true })).not.toBeChecked();
    expect((await stored()).persona.cookies['google.com']).toEqual(beforeClear.persona.cookies['google.com']);
    expect((await stored()).state.last_synced_at).toBe(beforeClear.state.last_synced_at);
    await expect(page.locator('.persona .status.error')).toHaveCount(0);

    // Future uploads of another site must include the cleared site's saved login.
    await harness.context.addCookies([{ name: 'login', value: 'still-syncing', domain: 'example.org', path: '/' }]);
    await expect.poll(async () => (await stored()).state.last_synced_at).not.toBe(beforeClear.state.last_synced_at);
    if (archivebox.collection) {
      const cookies = await serverCookies();
      expect(cookies.filter((cookie: { domain: string }) => cookie.domain === '.google.com'))
        .toEqual(renewedRemoteCookies.filter((cookie: { domain: string }) => cookie.domain === '.google.com'));
      expect(cookies).toContainEqual(expect.objectContaining({ domain: 'example.org', value: 'still-syncing' }));
    }
    await page.reload();
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Google', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Select example.org', exact: true })).toBeChecked();

    // Clearing the last tracked site also cancels a pending failed upload quietly.
    await harness.context.setOffline(true);
    await harness.context.addCookies([{ name: 'login', value: 'offline-renewal', domain: 'example.org', path: '/' }]);
    await expect.poll(async () => Boolean((await stored()).state.error)).toBe(true);
    await harness.context.clearCookies();
    await expect.poll(async () => (await stored()).state.domains).toEqual([]);
    const cleared = await stored();
    expect(cleared.state.pending).toBe(false);
    expect(cleared.state.error).toBeUndefined();
    expect(cleared.alarms.some(alarm => alarm.name === `archivebox-cookie-sync:${cleared.state.server_id}:${cleared.persona.id}`)).toBe(false);
    await expect(page.locator('.persona .status.error')).toHaveCount(0);
    await harness.context.setOffline(false);
    // A new account on a cleared site is not silently enrolled again.
    await harness.context.addCookies([{ name: 'login', value: 'different-account', domain: '.google.com', path: '/' }]);
    await page.getByRole('button', { name: 'Refresh cookies', exact: true }).click();
    expect((await stored()).state.domains).toEqual([]);
    expect((await stored()).persona.cookies['google.com']).toEqual(beforeClear.persona.cookies['google.com']);
    if (archivebox.collection) expect(await serverCookies()).toContainEqual(expect.objectContaining({ domain: '.google.com', value: 'renewed-login' }));
  } finally { await harness.close(); }
});
