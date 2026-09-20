// Run against a disposable real ArchiveBox server (no mocked API or clock).
// ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:5797 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-retention-live.mjs
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
if (!server || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE for a disposable real server.');
const key = (await readFile(keyFile, 'utf8')).trim();
const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-retention-live-'));
const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN
  || (existsSync(canary) ? canary : chromium.executablePath());
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run', '--no-default-browser-check',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
let browser;
async function api(route, init = {}) {
  const response = await fetch(server + route, { ...init, headers: { Authorization: 'Bearer ' + key, ...init.headers } });
  if (!response.ok) throw new Error('Real ArchiveBox API returned HTTP ' + response.status);
  return response.json();
}
try {
  let port;
  await expect.poll(async () => {
    port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0]).catch(() => '');
    return port;
  }).not.toBe('');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const cdp = await browser.newBrowserCDPSession();
  const extensionPath = path.join(profile, 'extension');
  await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Pregrant native permissions in this disposable test installation.
  manifest.permissions.push('bookmarks', 'tabs', 'scripting', 'pageCapture');
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const readEntries = () => page.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const config = async () => page.getByRole('navigation').getByRole('button', { name: 'Configuration', exact: true }).click();
  const retention = page.getByLabel('After saving on server, remove local copies after:');
  const serverInput = page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  const keyInput = page.getByPlaceholder('... abcexamplekey1234 ...');
  await config();
  await retention.selectOption('never');
  await serverInput.fill(server);
  await keyInput.fill(key);
  await keyInput.blur();

  const server_id = await page.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry.active_server_id);

  // Import actual browser bookmarks through the UI, then submit them through Sync.
  const suffix = Date.now();
  const names = ['queued', 'missing', 'local-only'];
  await page.evaluate(async ({ names, suffix }) => {
    for (const name of names) await chrome.bookmarks.create({ title: `Retention ${name} ${suffix}`, url: `https://example.com/retention-${name}-${suffix}` });
  }, { names, suffix });
  await page.getByRole('button', { name: 'Bulk Import URLs', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Browser Bookmarks', exact: true }).click();
  await expect(page.getByText('Loaded 3 bookmark URLs', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all visible import URLs' }).check();
  await page.getByRole('button', { name: 'Import Selected (3)', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Saved URLs', exact: true }).click();
  await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(3);
  for (const name of ['queued', 'missing']) {
    await page.locator('.saved-url-table tbody tr').filter({ hasText: `Retention ${name}` }).locator('input[type="checkbox"]').check();
  }
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(async () => (await readEntries()).filter((entry) => entry.remote_copies?.[server_id]?.submitted_at).length).toBe(2);
  await expect.poll(async () => (await readEntries()).filter((entry) => entry.remote_copies?.[server_id]?.snapshot_id).length).toBe(2);
  let entries = await readEntries();
  const queued = entries.find((entry) => entry.url.includes('retention-queued-'));
  const missing = entries.find((entry) => entry.url.includes('retention-missing-'));
  const localOnly = entries.find((entry) => entry.url.includes('retention-local-only-'));
  for (const entry of [queued, missing]) {
    expect(entry.remote_copies?.[server_id]?.submitted_to).toBe(server);
    expect(Date.now() - Date.parse(entry.remote_copies?.[server_id]?.submitted_at)).toBeLessThan(30000);
    const remote = await api('/api/v1/core/snapshot/' + (entry.remote_copies?.[server_id]?.snapshot_id || entry.id));
    expect(remote.url).toBe(entry.url);
    expect(remote.status).toBe('queued');
  }
  expect(localOnly.remote_copies?.[server_id]?.submitted_at).toBeUndefined();

  // Real OPFS fixture records: screenshot bytes from this real browser page, plus
  // partial/unindexed capture files in a second date tree, and a legacy path.
  const png = [...await page.screenshot()];
  await page.evaluate(async ({ png }) => {
    const root = await navigator.storage.getDirectory();
    const { entries } = await chrome.storage.local.get('entries');
    for (const entry of entries) {
      const capturePath = `snapshots/20260918/example.com/${entry.id}/chrome_extension_screenshot/screenshot.png`;
      for (const p of [capturePath, `snapshots/20260917/example.com/${entry.id}/partial/capture.bin`, `legacy/${entry.id}.mhtml`]) {
        const parts = p.split('/'); const file = parts.pop(); let dir = root;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
        const writer = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await writer.write(new Uint8Array(png)); await writer.close();
      }
      entry.screenshot = { storage: 'opfs', path: capturePath, mimeType: 'image/png', capturedAt: new Date().toISOString(), width: 1280, height: 720 };
      entry.mhtml = { storage: 'opfs', path: `legacy/${entry.id}.mhtml`, mimeType: 'multipart/related', capturedAt: new Date().toISOString(), size: png.length };
    }
    await chrome.storage.local.set({ entries });
    await chrome.storage.sync.set({ entries });
    await chrome.storage.session.set({ entries });
  }, { png });
  const viewer = await context.newPage();
  await viewer.goto(`chrome-extension://${id}/options.html?screenshot=${queued.id}`);
  await expect(viewer.locator('.screenshot-viewer-frame')).toBeVisible();
  // Remove only the test's own remote record to exercise a real 404.
  await api('/api/v1/core/snapshot/' + (missing.remote_copies?.[server_id]?.snapshot_id || missing.id), { method: 'DELETE' });
  console.log('Verified real submission timestamps and queued server state; waiting for the real one-minute TTL.');
  await expect.poll(() => Date.now() - Date.parse(queued.remote_copies?.[server_id]?.submitted_at), { timeout: 65000, intervals: [1000] }).toBeGreaterThanOrEqual(61000);
  expect((await readEntries()).length).toBe(3); // never

  // Offline networking, invalid auth, and never must preserve expired records and bytes.
  await config();
  await context.setOffline(true);
  await keyInput.fill(key); await keyInput.blur();
  await retention.selectOption('never'); await retention.selectOption('60000');
  expect((await readEntries()).length).toBe(3);
  await keyInput.fill('invalid-retention-test-key'); await keyInput.blur();
  await context.setOffline(false);
  // Wait for a real unauthorized API response to prove the cleanup path ran.
  const unauthorized = context.waitForEvent('response', (response) => response.url().includes('/api/v1/core/snapshot/') && response.status() === 401);
  await retention.selectOption('never'); await retention.selectOption('60000');
  await unauthorized;
  expect((await readEntries()).length).toBe(3);
  console.log('Verified never, offline, and authentication-failure preservation.');

  // Restore connection. Cleanup must accept queued state, remove only the backed
  // snapshot everywhere locally, refresh the viewer, and preserve its remote row.
  await keyInput.fill(key); await keyInput.blur();
  await expect.poll(async () => (await readEntries()).map((entry) => entry.id)).toEqual(expect.not.arrayContaining([queued.id]));
  await expect(viewer).toHaveURL(`chrome-extension://${id}/options.html`);
  const storage = await page.evaluate(async () => ({
    local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null), session: await chrome.storage.session.get(null),
    paths: await (async function list(dir, prefix = '') {
      const paths = [];
      for await (const [name, handle] of dir.entries()) {
        paths.push(prefix + name);
        if (handle.kind === 'directory') paths.push(...await list(handle, prefix + name + '/'));
      }
      return paths;
    })(await navigator.storage.getDirectory()),
  }));
  for (const area of [storage.local, storage.sync, storage.session]) {
    for (const pii of [queued.id, queued.url, queued.title]) expect(JSON.stringify(area)).not.toContain(pii);
  }
  expect(storage.paths.some((p) => p.includes(queued.id))).toBe(false);
  for (const retained of [missing, localOnly]) {
    expect(storage.local.entries.some((entry) => entry.id === retained.id)).toBe(true);
    expect(storage.paths.some((p) => p.includes(retained.id))).toBe(true);
  }
  const remote = await api('/api/v1/core/snapshot/' + (queued.remote_copies?.[server_id]?.snapshot_id || queued.id));
  expect(remote.url).toBe(queued.url); expect(remote.status).toBe('queued');
  console.log('Verified expired queued snapshot purged from OPFS/local/sync/session and viewer; missing/unsent snapshots retained; server copy intact.');

  // Resubmission restarts the clock. The recurring alarm (without changing any
  // settings or manually invoking cleanup) must remove the copy after that TTL.
  await page.getByRole('navigation').getByRole('button', { name: 'Saved URLs', exact: true }).click();
  for (const checkbox of await page.locator('.saved-url-table tbody input[type="checkbox"]').all()) await checkbox.uncheck();
  await page.locator('.saved-url-table tbody tr').filter({ hasText: 'Retention missing' }).locator('input[type="checkbox"]').check();
  const resubmittedAfter = Date.now();
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(async () => Date.parse((await readEntries()).find((entry) => entry.id === missing.id)?.remote_copies?.[server_id]?.submitted_at || '')).toBeGreaterThanOrEqual(resubmittedAfter);
  await expect(page.getByText('Finished syncing 1 snapshots', { exact: true })).toBeVisible();
  expect((await readEntries()).some((entry) => entry.id === missing.id)).toBe(true);
  const resubmitted = (await readEntries()).find((entry) => entry.id === missing.id);
  const resubmittedServerId = resubmitted.remote_copies?.[server_id]?.snapshot_id || resubmitted.id;
  expect((await api('/api/v1/core/snapshot/' + resubmittedServerId)).url).toBe(missing.url);
  // Stop the actual service worker, then wake it with a supported read-only message.
  const workerCdp = await context.newCDPSession(page);
  await workerCdp.send('ServiceWorker.enable');
  await workerCdp.send('ServiceWorker.stopAllWorkers');
  const connection = await page.evaluate((serverUrl) => chrome.runtime.sendMessage({ type: 'test_server_url', server: serverUrl }), server);
  expect(connection.ok).toBe(true);
  const alarm = await page.evaluate(() => chrome.alarms.get('archivebox-local-retention'));
  expect(alarm.periodInMinutes).toBe(1);
  expect((await readEntries()).some((entry) => entry.id === missing.id)).toBe(true);
  console.log('Verified resubmission resets TTL and worker restart preserves it; waiting for the recurring alarm.');
  await expect.poll(async () => (await readEntries()).map((entry) => entry.id), { timeout: 130000, intervals: [1000] }).toEqual([localOnly.id]);
  expect(Date.now() - resubmittedAfter).toBeGreaterThanOrEqual(60000);
  expect((await api('/api/v1/core/snapshot/' + resubmittedServerId)).url).toBe(missing.url);
  expect((await api('/api/v1/core/snapshot/' + (queued.remote_copies?.[server_id]?.snapshot_id || queued.id))).url).toBe(queued.url);
  console.log('PASS: real periodic alarm expired the resubmitted record after its new TTL, retained the local-only record, and kept both server copies.');
} finally {
  await browser?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve)); chrome.kill(); await exited;
  }
  await rm(profile, { recursive: true, force: true });
}
