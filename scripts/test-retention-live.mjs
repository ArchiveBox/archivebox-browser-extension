// Real browser captures, real ArchiveBox API, and real one-minute retention.
// Only creates uniquely named test URLs; never deletes server records.
import { expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchExtension } from '../tests/helpers/extension.ts';

const server = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
if (!server || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE');
const key = (await readFile(keyFile, 'utf8')).trim();
const evidence = process.env.ARCHIVEBOX_TEST_EVIDENCE;
if (evidence) await mkdir(evidence, { recursive: true });
const api = async route => {
  const response = await fetch(server + route, { headers: { Authorization: `Bearer ${key}` } });
  expect(response.status).toBe(200);
  return response.json();
};
const harness = await launchExtension(['tabs', 'scripting', 'pageCapture'], ['<all_urls>']);
try {
  const { context, id } = harness;
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  const configure = () => options.getByRole('button', { name: 'Configuration', exact: true }).click();
  const saved = () => options.getByRole('button', { name: 'Saved URLs', exact: true }).click();
  await configure();
  const rowTtl = options.getByLabel('Snapshot metadata retention');
  await rowTtl.selectOption('never');
  const address = options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  await address.fill(server); await address.blur();
  const token = options.getByPlaceholder('... abcexamplekey1234 ...');
  await token.fill(key); await token.blur();
  const registry = () => options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry);
  await expect.poll(async () => (await registry()).servers.some(server => server.token === key)).toBe(true);
  const serverId = (await registry()).active_server_id;
  const fullPage = options.getByLabel('Save full-page screenshots locally', { exact: true });
  await fullPage.click(); await expect(fullPage).toBeChecked();
  const entries = () => options.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const paths = () => options.evaluate(async () => {
    async function walk(directory, prefix = '') {
      const paths = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'directory') paths.push(...await walk(handle, prefix + name + '/'));
        else paths.push(prefix + name);
      }
      return paths;
    }
    return walk(await navigator.storage.getDirectory());
  });
  const captures = ['viewport_screenshot', 'screenshot', 'mhtml'];
  const records = {};
  const filePaths = capture => capture.parts?.length ? capture.parts.map(part => part.path) : [capture.path];
  for (const name of ['uploaded', 'url-only']) {
    for (const label of ['Upload viewport screenshots to server', 'Upload full-page screenshots to server', 'Upload MHTML snapshots to server']) {
      await options.getByLabel(label, { exact: true }).setChecked(name === 'uploaded');
    }
    const target = await context.newPage(); await target.setViewportSize({ width: 900, height: 120 });
    const url = `https://example.com/?archivebox-extension-ttl=${name}-${Date.now()}`;
    await target.goto(url);
    const popup = await context.newPage(); await target.bringToFront(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect.poll(async () => (await entries()).find(item => item.url === url)?.remote_copies?.[serverId]?.status, { timeout: 60000 }).toBe('complete');
    const entry = (await entries()).find(item => item.url === url);
    for (const kind of captures) expect(entry[kind]).toBeTruthy();
    records[name] = entry;
    const remote = await api('/api/v1/core/snapshot/' + entry.remote_copies[serverId].snapshot_id);
    expect(remote.url).toBe(url);
    for (const kind of captures) {
      const receipt = entry.remote_copies[serverId].artifacts?.[kind];
      if (name === 'uploaded') {
        expect(receipt.status).toBe('uploaded');
        const result = remote.archiveresults.find(result => result.id === receipt.archive_result_id);
        expect(result.status).toBe('succeeded');
        for (const path of filePaths(entry[kind])) expect((await paths()).includes(path)).toBe(true);
      } else expect(receipt).toBeUndefined();
    }
    await popup.close(); await target.close();
    console.log(`PASS: real ${name} record captured viewport, full-page screenshot, and MHTML: ${url}`);
  }
  const uploaded = records.uploaded;
  const copy = uploaded.remote_copies[serverId];
  const receipts = structuredClone(copy.artifacts);
  const before = {};
  for (const kind of captures) {
    for (const path of filePaths(uploaded[kind])) {
      const bytes = await options.evaluate(async path => {
        const segments = path.split('/'); const name = segments.pop(); let dir = await navigator.storage.getDirectory();
        for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
        return [...new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())];
      }, path);
      before[path] = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    }
  }
  // Leave TTLs at Never while the actual minute elapses. No backdated records,
  // patched clocks, manually fired alarms, or direct cleanup invocation.
  const uploadedAt = Math.max(...Object.values(receipts).map(receipt => Date.parse(receipt.uploaded_at)));
  console.log('Waiting for one real minute after confirmed uploads.');
  await expect.poll(() => Date.now() - uploadedAt, { timeout: 65000, intervals: [1000] }).toBeGreaterThanOrEqual(61000);
  for (const kind of captures) expect((await entries()).find(item => item.id === uploaded.id)[kind]).toBeTruthy();
  await context.setOffline(true);
  const offlineAttempt = context.waitForEvent('requestfailed', request => request.url().includes('/api/v1/core/snapshot/'));
  await options.getByLabel('MHTML retention', { exact: true }).selectOption('60000');
  await options.getByLabel('Viewport screenshot retention', { exact: true }).selectOption('60000');
  await offlineAttempt;
  for (const kind of captures) expect((await entries()).find(item => item.id === uploaded.id)[kind]).toBeTruthy();
  await token.fill('invalid-retention-e2e-token'); await token.blur();
  const denied = context.waitForEvent('response', response => response.url().includes('/api/v1/core/snapshot/') && response.status() === 401);
  await context.setOffline(false);
  await options.getByLabel('MHTML retention', { exact: true }).selectOption('snapshot');
  await options.getByLabel('MHTML retention', { exact: true }).selectOption('60000');
  await denied;
  for (const path of Object.keys(before)) expect((await paths()).includes(path)).toBe(true);
  console.log('PASS: Never, offline, and a real HTTP 401 retain expired files.');
  await token.fill(key); await token.blur();
  await expect.poll(async () => {
    const entry = (await entries()).find(item => item.id === uploaded.id);
    return Boolean(entry && !entry.mhtml && !entry.viewport_screenshot && entry.screenshot);
  }, { timeout: 30000 }).toBe(true);
  let retained = (await entries()).find(item => item.id === uploaded.id);
  expect(retained.url).toBe(uploaded.url); expect(retained.title).toBe(uploaded.title);
  expect(retained.remote_copies[serverId].artifacts).toEqual(receipts);
  const remaining = await paths();
  for (const kind of ['mhtml', 'viewport_screenshot']) for (const path of filePaths(uploaded[kind])) expect(remaining).not.toContain(path);
  for (const path of filePaths(uploaded.screenshot)) expect(remaining).toContain(path);
  for (const kind of captures) for (const path of filePaths(records['url-only'][kind])) expect(remaining).toContain(path);
  await saved(); await options.reload();
  const row = options.locator('tbody tr').filter({ hasText: uploaded.url });
  for (const kind of ['url', ...captures]) await expect(row.locator(`[data-sync-kind="${kind}"]`)).toHaveAttribute('data-state', 'uploaded');
  if (evidence) await options.screenshot({ path: `${evidence}/metadata-retained.png`, fullPage: true });
  console.log('PASS: MHTML and viewport files expired; full-page files, metadata, and upload receipts remain; unuploaded files remain.');

  const worker = await context.newCDPSession(options); await worker.send('ServiceWorker.enable'); await worker.send('ServiceWorker.stopAllWorkers');
  expect((await options.evaluate(server => chrome.runtime.sendMessage({ type: 'test_server_url', server }), server)).ok).toBe(true);
  expect((await options.evaluate(() => chrome.alarms.get('archivebox-local-retention'))).periodInMinutes).toBe(1);
  await configure();
  await options.getByLabel('Full-page screenshot retention', { exact: true }).selectOption('60000');
  await expect.poll(async () => Boolean((await entries()).find(item => item.id === uploaded.id)?.screenshot), { timeout: 30000 }).toBe(false);
  retained = (await entries()).find(item => item.id === uploaded.id);
  expect(retained.remote_copies[serverId].artifacts).toEqual(receipts);
  await rowTtl.selectOption('60000');
  await expect.poll(async () => (await entries()).some(item => item.id === uploaded.id), { timeout: 30000 }).toBe(false);
  for (const kind of captures) expect((await entries()).find(item => item.id === records['url-only'].id)[kind]).toBeTruthy();
  const remote = await api('/api/v1/core/snapshot/' + copy.snapshot_id);
  const results = [];
  for (const kind of captures) {
    const result = remote.archiveresults.find(result => result.id === receipts[kind].archive_result_id);
    expect(result.status).toBe('succeeded');
    for (const path of filePaths(uploaded[kind])) {
      const response = await fetch(`${server}/snapshot/${remote.id}/${result.plugin}/${path.split('/').at(-1)}`, { headers: { Authorization: `Bearer ${key}` } });
      expect(response.status).toBe(200);
      const sha256 = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      expect(sha256).toBe(before[path]); results.push({ kind, path, sha256 });
    }
  }
  console.log('PASS: independent full-page TTL and row TTL work after worker restart; every server file still matches the original captured bytes.');

  // Prove unattended expiry after a worker restart, without a settings change
  // or manual cleanup once this new capture has been uploaded.
  await rowTtl.selectOption('never');
  await options.getByLabel('Viewport screenshot retention', { exact: true }).selectOption('snapshot');
  await options.getByLabel('Full-page screenshot retention', { exact: true }).selectOption('snapshot');
  await options.getByLabel('Upload MHTML snapshots to server', { exact: true }).check();
  const target = await context.newPage();
  const periodicUrl = `https://example.com/?archivebox-extension-ttl=periodic-${Date.now()}`;
  await target.goto(periodicUrl);
  const popup = await context.newPage(); await target.bringToFront(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect.poll(async () => (await entries()).find(item => item.url === periodicUrl)?.remote_copies?.[serverId]?.artifacts?.mhtml?.status, { timeout: 60000 }).toBe('uploaded');
  const periodic = (await entries()).find(item => item.url === periodicUrl);
  records.periodic = periodic;
  await popup.close(); await target.close();
  await worker.send('ServiceWorker.stopAllWorkers');
  expect((await options.evaluate(server => chrome.runtime.sendMessage({ type: 'test_server_url', server }), server)).ok).toBe(true);
  expect((await options.evaluate(() => chrome.alarms.get('archivebox-local-retention'))).periodInMinutes).toBe(1);
  expect((await entries()).find(item => item.id === periodic.id).mhtml).toBeTruthy();
  console.log('Waiting for the recurring alarm after a real worker restart.');
  await expect.poll(async () => Boolean((await entries()).find(item => item.id === periodic.id)?.mhtml), { timeout: 130000, intervals: [1000] }).toBe(false);
  expect(Date.now() - Date.parse(periodic.remote_copies[serverId].artifacts.mhtml.uploaded_at)).toBeGreaterThanOrEqual(60000);
  const afterAlarm = (await entries()).find(item => item.id === periodic.id);
  expect(afterAlarm.url).toBe(periodic.url);
  expect(afterAlarm.viewport_screenshot).toEqual(periodic.viewport_screenshot);
  expect(afterAlarm.screenshot).toEqual(periodic.screenshot);
  expect(afterAlarm.remote_copies[serverId].artifacts).toEqual(periodic.remote_copies[serverId].artifacts);
  expect(await paths()).not.toContain(periodic.mhtml.path);
  for (const kind of ['viewport_screenshot', 'screenshot']) for (const path of filePaths(periodic[kind])) expect(await paths()).toContain(path);
  expect((await api('/api/v1/core/snapshot/' + periodic.remote_copies[serverId].snapshot_id)).url).toBe(periodic.url);
  console.log('PASS: the recurring alarm removed only uploaded MHTML after its TTL; unuploaded screenshots and metadata remain.');

  // The metadata switch controls post-upload retention, without losing pending
  // files or their parent rows. Create another real submission with no files.
  for (const label of ['Save viewport screenshots locally', 'Save full-page screenshots locally', 'Save MHTML snapshots locally']) {
    await options.getByLabel(label, { exact: true }).uncheck();
  }
  const metadata = options.getByLabel('Save snapshot metadata locally', { exact: true });
  await expect(metadata).toBeChecked();
  const metadataUrl = `https://example.com/?archivebox-extension-metadata=${Date.now()}`;
  const metadataPage = await context.newPage(); await metadataPage.goto(metadataUrl);
  const metadataPopup = await context.newPage(); await metadataPage.bringToFront();
  await metadataPopup.goto(`chrome-extension://${id}/popup.html`);
  await expect.poll(async () => (await entries()).find(item => item.url === metadataUrl)?.remote_copies?.[serverId]?.status, { timeout: 60000 }).toBe('complete');
  const metadataEntry = (await entries()).find(item => item.url === metadataUrl);
  for (const kind of captures) expect(metadataEntry[kind]).toBeUndefined();
  await metadataPopup.close(); await metadataPage.close();
  await metadata.uncheck();
  await expect.poll(async () => (await entries()).some(item => item.id === metadataEntry.id)).toBe(false);
  for (const entry of [records['url-only'], afterAlarm]) {
    const kept = (await entries()).find(item => item.id === entry.id);
    expect(kept).toBeTruthy();
    for (const kind of captures) if (entry[kind]) {
      expect(kept[kind]).toEqual(entry[kind]);
      for (const path of filePaths(entry[kind])) expect(await paths()).toContain(path);
    }
  }
  expect((await api('/api/v1/core/snapshot/' + metadataEntry.remote_copies[serverId].snapshot_id)).url).toBe(metadataUrl);
  console.log('PASS: disabling metadata removes the confirmed metadata-only row and preserves every unuploaded file, its metadata, and the server snapshot.');
  if (evidence) await writeFile(`${evidence}/result.json`, JSON.stringify({ server, tested_at: new Date().toISOString(), periodic_alarm_verified: true, records, files: results }, null, 2));
} finally { await harness.close(); }
