import { expect, test } from '@playwright/test';
import { launchExtension, waitForSavedSettings } from './helpers/extension';
import type { ServerRegistry } from '../src/lib/types';

type ConnectionBarrier = typeof globalThis & {
  chrome: typeof browser;
  serverRefreshBlocked: Promise<void>;
  releaseServerRefresh: () => void;
};

test('an API key cannot save before its new server identity has loaded', async () => {
  const harness = await launchExtension();
  const server = 'http://127.0.0.1:1';
  const keyValue = 'synthetic-fixture-key';
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html#Configuration`);
    const url = options.getByRole('textbox', { name: 'ArchiveBox Server URL' });
    const key = options.getByLabel('API Key', { exact: true });
    await options.evaluate(server => {
      const fixture = globalThis as ConnectionBarrier;
      fixture.serverRefreshBlocked = new Promise<void>(acquired => {
        const onChange: Parameters<typeof fixture.chrome.storage.onChanged.addListener>[0] = (changes, area) => {
          const registry = changes.server_registry?.newValue as ServerRegistry | undefined;
          if (area !== 'local' || !registry?.servers.some(item => item.server === server)) return;
          fixture.chrome.storage.onChanged.removeListener(onChange);
          // The settings save has persisted, but its subsequent settings read
          // uses this real shared lock. Hold that refresh until the test checks
          // that the dependent API-key input is still unavailable.
          void navigator.locks.request('archivebox-storage-migration', () => new Promise<void>(release => {
            fixture.releaseServerRefresh = release;
            acquired();
          }));
        };
        fixture.chrome.storage.onChanged.addListener(onChange);
      });
    }, server);
    await url.fill(server);
    await url.blur();
    await options.evaluate(() => (globalThis as ConnectionBarrier).serverRefreshBlocked);
    try {
      await expect(key).toBeDisabled();
    } finally {
      await options.evaluate(() => (globalThis as ConnectionBarrier).releaseServerRefresh());
    }
    await key.fill(keyValue);
    await key.blur();
    await waitForSavedSettings(options);
    await options.reload();
    await expect(url).toHaveValue(server);
    await expect(key).toHaveValue(keyValue);
  } finally { await harness.close(); }
});
