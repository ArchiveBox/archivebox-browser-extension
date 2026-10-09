// Real browser captures and ArchiveBox uploads; use a disposable collection without workers.
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { launchExtension } from '../tests/helpers/extension.ts';

const server = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
if (!server || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE.');
const key = (await readFile(keyFile, 'utf8')).trim();
const evidence = process.env.ARCHIVEBOX_TEST_EVIDENCE;
if (evidence) await mkdir(evidence, { recursive: true });
const source = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Delivery status test</title><body style="background:#f9f2e4"><h1>Actual browser capture</h1><p>Screenshot and MHTML delivery</p></body>');
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = process.env.ARCHIVEBOX_TEST_CAPTURE_URL || `http://127.0.0.1:${source.address().port}`;
const harness = await launchExtension(['tabs', 'scripting', 'pageCapture'], ['<all_urls>']);
try {
  const { context, id } = harness;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const configure = () => options.getByRole('button', { name: 'Configuration', exact: true }).click();
  const saved = () => options.getByRole('button', { name: 'Saved URLs', exact: true }).click();
  await configure();
  await options.getByLabel('Snapshot metadata retention').selectOption('never');
  const address = options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  await address.fill(server); await address.blur();
  const token = options.getByPlaceholder('... abcexamplekey1234 ...');
  await token.fill(key); await token.blur();
  const registry = () => options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry);
  await expect.poll(async () => Boolean((await registry())?.servers[0]?.token)).toBe(true);
  const serverId = (await registry()).active_server_id;
  const entries = () => options.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const urls = {};
  for (const [name, viewport, mhtml] of [['url-only', false, false], ['screenshot-only', true, false], ['mhtml-only', false, true], ['both', true, true], ['partial', true, false]]) {
    await configure();
    await options.getByLabel('Save MHTML snapshots locally', { exact: true }).setChecked(name !== 'partial');
    await options.getByLabel('Upload viewport screenshots to server', { exact: true }).setChecked(viewport);
    await options.getByLabel('Upload MHTML snapshots to server', { exact: true }).setChecked(mhtml);
    await saved();
    const target = await context.newPage();
    const url = `${origin}/?archivebox-extension-delivery=${name}-${Date.now()}`;
    urls[name] = url;
    await target.goto(url);
    const popup = await context.newPage();
    await target.bringToFront();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect.poll(async () => (await entries()).find(item => item.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
    const entry = (await entries()).find(item => item.url === url);
    expect(entry.viewport_screenshot).toBeTruthy();
    expect(Boolean(entry.mhtml)).toBe(name !== 'partial');
    const response = await fetch(`${server}/api/v1/core/snapshot/${entry.remote_copies[serverId].snapshot_id}`, { headers: { Authorization: `Bearer ${key}` } });
    expect(response.status).toBe(200);
    const remote = await response.json();
    for (const [plugin, uploaded] of [['chrome_extension_viewport', viewport], ['chrome_extension_mhtml', mhtml]]) {
      expect(remote.archiveresults.some(result => result.plugin === plugin && result.status === 'succeeded' && result.output_size > 0)).toBe(uploaded);
      if (uploaded) {
        const capture = plugin === 'chrome_extension_mhtml' ? entry.mhtml : entry.viewport_screenshot;
        const bytes = await options.evaluate(async path => {
          const parts = path.split('/'); const name = parts.pop(); let directory = await navigator.storage.getDirectory();
          for (const part of parts) directory = await directory.getDirectoryHandle(part);
          return [...new Uint8Array(await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer())];
        }, capture.path);
        const replay = await fetch(`${server}/snapshot/${remote.id}/${plugin}/${capture.path.split('/').at(-1)}`, { headers: { Authorization: `Bearer ${key}` } });
        expect(replay.status).toBe(200);
        expect(Buffer.from(await replay.arrayBuffer())).toEqual(Buffer.from(bytes));
      }
    }
    await popup.close(); await target.close();
    await options.reload();
    const row = options.locator('.saved-url-table tbody tr').filter({ hasText: url });
    if (evidence) await options.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
    await expect(row.locator('[data-sync-kind="url"]')).toHaveAttribute('data-state', 'uploaded');
    await expect(row.locator('[data-sync-kind="viewport_screenshot"]')).toHaveAttribute('data-state', viewport ? 'uploaded' : 'local');
    await expect(row.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', mhtml ? 'uploaded' : name === 'partial' ? 'missing' : 'local');
    await row.getByRole('button', { name: /^MHTML:/ }).click();
    await expect(row.locator('[data-sync-kind="mhtml"]')).toBeVisible();
    if (evidence && name === 'both') await options.screenshot({ path: `${evidence}/mhtml-details.png`, fullPage: true });
    await options.keyboard.press('Escape');
    console.log(`PASS: ${name} has accurate persistent URL, screenshot, and MHTML states after refresh.`);
  }
  // A real unauthorized MHTML upload must not erase an earlier screenshot receipt.
  await configure();
  await options.getByLabel('Upload viewport screenshots to server', { exact: true }).uncheck();
  await options.getByLabel('Upload MHTML snapshots to server', { exact: true }).check();
  await token.fill('invalid-upload-test-token'); await token.blur();
  await expect.poll(async () => (await registry()).servers[0].token).toBe('invalid-upload-test-token');
  const target = await context.newPage(); await target.goto(urls.partial);
  const popup = await context.newPage(); await target.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByTitle('Save an MHTML snapshot for this URL', { exact: true }).click();
  await expect.poll(async () => (await entries()).find(item => item.url === urls.partial)?.remote_copies?.[serverId]?.artifacts?.mhtml?.status).toBe('failed');
  await popup.close(); await target.close();
  await options.reload();
  const partial = options.locator('.saved-url-table tbody tr').filter({ hasText: urls.partial });
  await expect(partial.locator('[data-sync-kind="url"]')).toHaveAttribute('data-state', 'uploaded');
  await expect(partial.locator('[data-sync-kind="viewport_screenshot"]')).toHaveAttribute('data-state', 'uploaded');
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'failed');
  await partial.getByRole('button', { name: /^MHTML:/ }).click();
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toContainText('HTTP 401');
  if (evidence) await options.screenshot({ path: `${evidence}/failed-mhtml.png`, fullPage: true });
  await options.keyboard.press('Escape');
  console.log('PASS: a failed MHTML upload persists while URL and screenshot remain confirmed.');

  await configure(); await token.fill(key); await token.blur();
  await expect.poll(async () => (await registry()).servers[0].token === key).toBe(true);
  await saved();
  await partial.locator('input[type="checkbox"]').check();
  await options.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'uploaded');
  await context.setOffline(true);
  await options.reload();
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'uploaded');
  await expect(partial.locator('[data-sync-kind="viewport_screenshot"]')).toHaveAttribute('data-state', 'uploaded');
  await context.setOffline(false);
  console.log('PASS: successful retry replaces the failure; per-file receipts survive an offline refresh.');

  const previousCopy = (await entries()).find(item => item.url === urls.partial).remote_copies[serverId];
  await partial.locator('input[type="checkbox"]').check();
  await options.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(async () => (await entries()).find(item => item.url === urls.partial).remote_copies[serverId].crawl_id).not.toBe(previousCopy.crawl_id);
  await expect.poll(async () => (await entries()).find(item => item.url === urls.partial).remote_copies[serverId].status).toBe('complete');
  expect((await entries()).find(item => item.url === urls.partial).remote_copies[serverId].owned_crawl_id).toBe(previousCopy.owned_crawl_id);
  expect((await entries()).find(item => item.url === urls.partial).remote_copies[serverId].artifacts).toEqual(previousCopy.artifacts);
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'uploaded');
  await expect(partial.locator('[data-sync-kind="viewport_screenshot"]')).toHaveAttribute('data-state', 'uploaded');

  // The existing address editor must never borrow another destination's receipt.
  await configure();
  const alternate = new URL(server); alternate.port = String(Number(alternate.port) + 1);
  await address.fill(alternate.origin); await address.blur();
  await expect.poll(async () => (await registry()).active_server_id).not.toBe(serverId);
  await saved();
  await expect(partial.locator('[data-sync-kind="url"]')).toHaveAttribute('data-state', 'local');
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'local');
  await configure(); await address.fill(server); await address.blur();
  await expect.poll(async () => (await registry()).active_server_id).toBe(serverId);
  await saved();
  await expect(partial.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'uploaded');
  console.log('PASS: repeated Sync retains ownership and file receipts; changing the configured address cannot borrow them.');

  for (const width of [320, 600, 1280]) {
    await options.setViewportSize({ width, height: 844 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await partial.getByRole('button', { name: /^Viewport screenshot:/ }).click();
    const panel = partial.locator('.files-icon-pile-popup:popover-open');
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (evidence) await options.screenshot({ path: `${evidence}/delivery-${width}.png`, fullPage: true });
    await options.keyboard.press('Escape');
  }

  // A fresh browser saving the same URL has no ownership receipt for the older
  // capture. It must not replace those files or claim its own captures uploaded.
  const other = await launchExtension(['tabs', 'scripting', 'pageCapture'], ['<all_urls>']);
  try {
    const settings = await other.context.newPage();
    await settings.goto(`chrome-extension://${other.id}/options.html`);
    await settings.getByRole('button', { name: 'Configuration', exact: true }).click();
    const otherAddress = settings.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
    await otherAddress.fill(server); await otherAddress.blur();
    const otherToken = settings.getByPlaceholder('... abcexamplekey1234 ...');
    await otherToken.fill(key); await otherToken.blur();
    const otherId = await settings.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry.active_server_id);
    const uploads = [];
    other.context.on('request', request => { if (request.url().includes('/api/v1/core/archiveresult') && ['POST', 'PATCH'].includes(request.method())) uploads.push(request.url()); });
    const website = await other.context.newPage(); await website.goto(urls.both);
    const panel = await other.context.newPage(); await website.bringToFront(); await panel.goto(`chrome-extension://${other.id}/popup.html`);
    await expect.poll(() => settings.evaluate(async serverId => (await chrome.storage.local.get('entries')).entries?.[0]?.remote_copies?.[serverId]?.status, otherId), { timeout: 30000 }).toBe('complete');
    await settings.reload();
    const row = settings.locator('.saved-url-table tbody tr').filter({ hasText: urls.both });
    await expect(row.locator('[data-sync-kind="url"]')).toHaveAttribute('data-state', 'uploaded');
    await expect(row.locator('[data-sync-kind="mhtml"]')).toHaveAttribute('data-state', 'local');
    await expect(row.locator('[data-sync-kind="viewport_screenshot"]')).toHaveAttribute('data-state', 'local');
    expect(uploads).toEqual([]);
    console.log('PASS: reusing another submission\'s snapshot does not upload files or fabricate file receipts.');
  } finally { await other.close(); }
} finally {
  await harness.close();
  await new Promise((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
}
