import { expect } from '@playwright/test';
import { test } from './helpers/archivebox';
import { launchExtension, seedExtensionStorage, waitForSavedSettings } from './helpers/extension';
import type { Page } from '@playwright/test';
import type { Persona } from '../src/lib/types';

const readPersonas = (page: Page): Promise<Persona[]> => page.evaluate(async () =>
  (await (globalThis as typeof globalThis & { chrome: typeof browser }).chrome.storage.local.get('personas')).personas as Persona[]);

test('every sync exports this browser\'s live UA, client hints, and platform', async ({ archivebox }) => {
  const harness = await launchExtension([], ['<all_urls>']);
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await options.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await options.getByLabel('API Key', { exact: true }).blur();
    await waitForSavedSettings(options);

    const live = await options.evaluate(async () => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hints: await (navigator as any).userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'wow64', 'formFactors',
      ]),
    }));
    // A Private profile recorded by an older browser version and extension
    // release: its UA predates this browser update and it has no client hints.
    // Work was given another UA, which it must keep exactly as configured.
    const staleUserAgent = live.userAgent.replace(/Chrome\/[\d.]+/, 'Chrome/100.0.0.0');
    expect(staleUserAgent).not.toBe(live.userAgent);
    const stalePersonas = { Private: { userAgent: staleUserAgent, language: 'en-US' }, Work: { userAgent: 'ArchiveBox custom UA' } };
    await seedExtensionStorage(options, {
      personas: (await readPersonas(options)).map(persona =>
        ({ ...persona, settings: stalePersonas[persona.name as keyof typeof stalePersonas] || persona.settings })),
    });
    await options.reload();
    await options.getByRole('button', { name: 'Cookies', exact: true }).click();
    for (const name of Object.keys(stalePersonas)) {
      await options.getByRole('tab', { name, exact: true }).click();
      await options.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect(options.locator('.persona-sync-time time')).toBeVisible();
    }

    const synced = (await archivebox.api('/api/v1/personas/personas?limit=100')).items;
    const config = (name: string) => synced.find((persona: any) => persona.name === name)?.config;
    expect(config('Private')).toMatchObject({
      USER_AGENT: live.userAgent,
      CHROME_USER_AGENT: live.userAgent,
      BROWSER_PLATFORM: live.platform,
      BROWSER_USER_AGENT_METADATA: live.hints,
      BROWSER_LANGUAGE: 'en-US',
    });
    expect(live.hints.platform).toBeTruthy();
    expect(config('Work')).toMatchObject({ USER_AGENT: 'ArchiveBox custom UA', BROWSER_PLATFORM: '' });
    expect(config('Work').BROWSER_USER_AGENT_METADATA).toBeUndefined();

    // The refreshed identity is what the options page shows for the profile.
    const stored = (await readPersonas(options)).find(persona => persona.name === 'Private')!.settings;
    expect(stored).toMatchObject({ userAgent: live.userAgent, platform: live.platform, userAgentMetadata: live.hints });
  } finally {
    await harness.close();
  }
});
