import { expect } from '@playwright/test';
import { test } from './helpers/archivebox';
import { launchExtension, readSnapshots, waitForSavedSettings } from './helpers/extension';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

test('delete everywhere stays open, reports server failure, and can restore the capture', async ({ archivebox }, testInfo) => {
  const document = await readFile(new URL('./fixtures/auto-archive.html', import.meta.url));
  const source = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(document); });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const url = `http://127.0.0.1:${address.port}/delete`;
  const harness = await launchExtension(['tabs', 'pageCapture'], ['<all_urls>']);
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    const key = options.getByLabel('API Key', { exact: true });
    await key.fill(archivebox.key); await key.blur();
    await waitForSavedSettings(options);
    await options.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
    await waitForSavedSettings(options);
    const target = await harness.context.newPage(); await target.goto(url);
    await target.bringToFront();
    const popup = await harness.context.newPage();
    await popup.goto(`chrome-extension://${harness.id}/popup.html`);
    const saved = async () => (await readSnapshots(options)).find(item => item.url === url);
    await expect.poll(async () => Object.values((await saved())?.remote_copies || {})[0]?.status).toBe('complete');
    const original = (await saved())!;
    const remoteId = Object.values(original.remote_copies!)[0]!.snapshot_id!;
    expect(original.mhtml?.path).toBeTruthy();
    const viewer = await harness.context.newPage();
    const viewerUrl = `chrome-extension://${harness.id}/options.html?mhtml=${original.id}`;
    await viewer.goto(viewerUrl);
    await expect(viewer.frameLocator('.mhtml-viewer-frame').getByRole('heading', { name: 'Automatic archiving regression' })).toBeVisible();
    const remoteStatus = () => fetch(`${archivebox.server}/api/v1/core/snapshot/${remoteId}`, { headers: { Authorization: `Bearer ${archivebox.key}` } }).then(response => response.status);
    await key.fill('invalid-delete-token'); await key.blur(); await waitForSavedSettings(options);
    await expect(popup.getByRole('button', { name: 'Delete everywhere', exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Delete everywhere', exact: true }).click();
    await expect(popup.getByRole('alert')).toContainText('401');
    expect(await saved()).toBeTruthy();
    expect(await remoteStatus()).toBe(200);
    await expect(viewer).toHaveURL(viewerUrl);
    await key.fill(archivebox.key); await key.blur(); await waitForSavedSettings(options);
    await popup.getByRole('button', { name: 'Delete everywhere', exact: true }).click();
    await expect(popup.getByRole('heading', { name: 'Deleted everywhere', exact: true })).toBeVisible();
    expect(popup.isClosed()).toBe(false);
    expect(await saved()).toBeUndefined();
    await expect(viewer).toHaveURL(`chrome-extension://${harness.id}/options.html`);
    await expect(viewer.locator('.mhtml-viewer-frame')).toHaveCount(0);
    await expect.poll(remoteStatus).toBe(404);
    expect(await options.evaluate(async path => {
      try {
        const segments = path.split('/').filter(Boolean);
        let directory = await navigator.storage.getDirectory();
        for (const part of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
        await directory.getFileHandle(segments.at(-1)!); return true;
      } catch (error) { if ((error as DOMException).name === 'NotFoundError') return false; throw error; }
    }, original.mhtml!.path)).toBe(false);
    await expect(popup.getByRole('button', { name: 'Persona', exact: true })).toHaveCount(0);
    await expect(popup.getByPlaceholder('+ tag', { exact: true })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Options', exact: true })).toBeVisible();
    const optionsOpened = harness.context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Options', exact: true }).click();
    const newOptions = await optionsOpened;
    await newOptions.waitForURL(`chrome-extension://${harness.id}/options.html`);
    expect(newOptions).not.toBe(options);
    await newOptions.close();
    await popup.screenshot({ path: testInfo.outputPath('popup-deleted.png') });
    await popup.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(popup.getByRole('heading', { name: 'Deleted everywhere', exact: true })).toHaveCount(0);
    await expect.poll(async () => Object.values((await saved())?.remote_copies || {})[0]?.status).toBe('complete');
    const restored = (await saved())!;
    expect(restored.id).not.toBe(original.id);
    const restoredId = Object.values(restored.remote_copies!)[0]!.snapshot_id!;
    expect(restoredId).not.toBe(remoteId);
    expect((await archivebox.api(`/api/v1/core/snapshot/${restoredId}`)).url).toBe(url);
    expect(restored.mhtml?.path).toBeTruthy();
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});
