import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { test } from './helpers/archivebox';
import { launchExtension, readSnapshots, waitForSavedSettings } from './helpers/extension';

test('snapshot metadata upload is a real switch that artifact uploads turn on', async ({ archivebox }, testInfo) => {
  const source = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Local only</title><p>local only</p>');
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const url = `http://127.0.0.1:${address.port}/local-only`;
  const harness = await launchExtension(['tabs'], ['<all_urls>']);
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).fill(archivebox.server);
    await options.getByLabel('ArchiveBox Server URL', { exact: true }).blur();
    await options.getByLabel('API Key', { exact: true }).fill(archivebox.key);
    await options.getByLabel('API Key', { exact: true }).blur();
    await options.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
    await options.getByLabel('Save MHTML snapshots locally', { exact: true }).uncheck();
    await waitForSavedSettings(options);

    const metadata = options.getByLabel('Upload snapshot metadata to server', { exact: true });
    const artifacts = ['Upload viewport screenshots to server', 'Upload full-page screenshots to server', 'Upload MHTML snapshots to server']
      .map(label => options.getByLabel(label, { exact: true }));
    await expect(options.getByText('Included', { exact: true })).toHaveCount(0);
    await expect(metadata).toBeChecked();
    await expect(artifacts[0]!).toBeChecked();
    await options.locator('.capture-grid').screenshot({ path: testInfo.outputPath('metadata-upload.png') });

    // Artifacts upload into the server's snapshot, so they stop with metadata...
    await metadata.uncheck();
    for (const artifact of artifacts) await expect(artifact).not.toBeChecked();
    // ...and turning any of them on turns metadata back on.
    await artifacts[2]!.check();
    await expect(metadata).toBeChecked();
    await metadata.uncheck();
    await waitForSavedSettings(options);
    await options.reload();
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(metadata).not.toBeChecked();
    for (const artifact of artifacts) await expect(artifact).not.toBeChecked();

    // With metadata upload off, opening the popup saves locally and sends nothing.
    const target = await harness.context.newPage();
    await target.goto(url);
    const popup = await harness.context.newPage();
    await target.bringToFront();
    await popup.goto(`chrome-extension://${harness.id}/popup.html`);
    await expect(popup.getByText('Saved locally. Server upload is turned off.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readSnapshots(options)).some(item => item.url === url)).toBe(true);
    expect((await readSnapshots(options)).find(item => item.url === url)?.remote_copies || {}).toEqual({});
    expect((await archivebox.api(`/api/v1/core/snapshots?url=${encodeURIComponent(url)}`)).items).toEqual([]);

    // Sync is an explicit request and still sends the URL.
    await popup.getByTitle('Sync to ArchiveBox server', { exact: true }).click();
    await expect.poll(async () => (await archivebox.api(`/api/v1/core/snapshots?url=${encodeURIComponent(url)}`)).items.length, { timeout: 30_000 }).toBe(1);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});
