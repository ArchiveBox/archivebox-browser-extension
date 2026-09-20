// Run against a disposable real ArchiveBox server (no mocked API or clock).
// ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:5797 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-retention-live.mjs
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = process.env.ARCHIVEBOX_TEST_SERVER;
const second_server = process.env.ARCHIVEBOX_TEST_SECOND_SERVER;
const second_key = (await readFile(process.env.ARCHIVEBOX_TEST_SECOND_KEY_FILE, 'utf8')).trim();
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
  const registry = () => page.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry);
  const copies = async () => (await readEntries())[0]?.remote_copies || {};
  const configure = async (address, token, persona) => {
    await config();
    await retention.selectOption('never');
    await serverInput.fill(address);
    await serverInput.blur();
    await expect.poll(async () => (await registry())?.servers.find((item) => item.server === address)?.server).toBe(address);
    await keyInput.fill(token);
    await keyInput.blur();
    await expect(page.getByLabel('Default Persona').locator(`option[value="${persona}"]`)).toHaveCount(1);
    await page.getByLabel('Default Persona').selectOption(persona);
    await expect.poll(async () => (await registry()).servers.find((item) => item.server === address)?.persona).toBe(persona);
    return (await registry()).active_server_id;
  };
  const first_id = await configure(server, key, 'Personal');
  const url = `https://example.com/?multiserver=${Date.now()}`;
  await page.evaluate(async (url) => chrome.bookmarks.create({ title: 'Multi-server acceptance', url }), url);
  await page.getByRole('button', { name: 'Bulk Import URLs', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Browser Bookmarks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all visible import URLs' }).check();
  await page.getByRole('button', { name: 'Import Selected (1)', exact: true }).click();
  const sync = async (server_id) => {
    await page.getByRole('navigation').getByRole('button', { name: 'Saved URLs', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select all visible URLs' }).check();
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect.poll(async () => (await copies())[server_id]?.status, { timeout: 30000 }).toBe('complete');
  };
  await sync(first_id);
  let first_copy = (await copies())[first_id];
  expect(first_copy.persona).toBe('Personal');
  const first_remote = await api('/api/v1/core/snapshot/' + first_copy.snapshot_id);
  expect(first_remote.url).toBe(url);
  const local_id = (await readEntries())[0].id;
  expect(first_copy.snapshot_id).not.toBe(local_id);
  await config();
  await page.getByLabel('Upload screenshots to server').check();
  await keyInput.fill('invalid-upload-test-token'); await keyInput.blur();
  await expect.poll(async () => (await registry()).servers.find((item) => item.id === first_id).token).toBe('invalid-upload-test-token');
  const capture_page = await context.newPage();
  await capture_page.goto(url);
  await capture_page.bringToFront();
  const capture_popup = await context.newPage();
  await capture_popup.goto(`chrome-extension://${id}/popup.html`);
  await capture_popup.getByTitle('Save a screenshot for this URL. Full-page scrolling may ask for optional scripting permission; denying it saves the visible area.').click();
  await expect(capture_popup.getByText(/Failed to upload artifact/)).toBeVisible();
  await expect.poll(async () => (await copies())[first_id]?.status).toBe('accepted');
  expect((await readEntries())[0].screenshot.path).toBeTruthy();
  await capture_popup.close(); await capture_page.close();
  await retention.selectOption('60000');
  await expect.poll(() => Date.now() - Date.parse(first_copy.submitted_at), { timeout: 65000, intervals: [1000] }).toBeGreaterThanOrEqual(61000);
  await page.reload(); await config();
  expect(await readEntries()).toHaveLength(1);
  expect((await readEntries())[0].screenshot.path).toBeTruthy();
  expect((await copies())[first_id].status).toBe('accepted');
  await retention.selectOption('never');
  await keyInput.fill(key); await keyInput.blur();
  await expect.poll(async () => (await registry()).servers.find((item) => item.id === first_id).token).toBe(key);
  await sync(first_id);
  first_copy = (await copies())[first_id];
  expect((await api('/api/v1/core/snapshot/' + first_copy.snapshot_id)).archiveresults.some((result) => result.plugin === 'chrome_extension_screenshot' && result.status === 'succeeded')).toBe(true);
  console.log('Verified a failed new capture upload stays pending through its real retention deadline, then completes after a successful sync.');
  const second_id = await configure(second_server, second_key, 'Work');
  await page.getByLabel('Upload screenshots to server').check();
  expect(second_id).not.toBe(first_id);
  await sync(second_id);
  const second_copy = (await copies())[second_id];
  expect(second_copy.persona).toBe('Work');
  expect(second_copy.snapshot_id).not.toBe(first_copy.snapshot_id);
  expect(second_copy.crawl_id).not.toBe(first_copy.crawl_id);
  const second_api = async (route) => {
    const response = await fetch(second_server + route, { headers: { Authorization: 'Bearer ' + second_key } });
    if (!response.ok) throw new Error('Second real server returned HTTP ' + response.status);
    return response.json();
  };
  expect((await second_api('/api/v1/core/snapshot/' + second_copy.snapshot_id)).url).toBe(url);
  expect((await second_api('/api/v1/core/snapshot/' + second_copy.snapshot_id)).archiveresults.some((result) => result.plugin === 'chrome_extension_screenshot' && result.status === 'succeeded')).toBe(true);
  expect((await copies())[first_id]).toEqual(first_copy);
  await config();
  await keyInput.fill('invalid-test-token'); await keyInput.blur();
  await expect.poll(async () => (await registry()).servers.find((item) => item.id === second_id).token).toBe('invalid-test-token');
  expect((await registry()).active_server_id).toBe(second_id);
  await retention.selectOption('60000');
  await expect.poll(() => Date.now() - Date.parse(first_copy.submitted_at), { timeout: 65000, intervals: [1000] }).toBeGreaterThanOrEqual(61000);
  await page.reload(); await config();
  expect((await readEntries())).toHaveLength(1);
  expect(Object.keys(await copies()).sort()).toEqual([first_id, second_id].sort());
  // One unreachable destination must retain the local copy even when another is healthy.
  await retention.selectOption('never');
  await keyInput.fill(second_key); await keyInput.blur();
  await expect.poll(async () => (await registry()).servers.find((item) => item.id === second_id).token).toBe(second_key);
  await page.reload();
  expect((await registry()).servers).toHaveLength(2);
  expect((await registry()).servers.find((item) => item.id === first_id).persona).toBe('Personal');
  expect((await registry()).servers.find((item) => item.id === second_id).persona).toBe('Work');
  // Open the real popup on the bookmarked page, then use its remove button.
  const website = await context.newPage();
  await website.goto(url);
  await website.bringToFront();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByTitle('Remove from ArchiveBox server', { exact: true })).toBeVisible();
  popup.on('dialog', (dialog) => dialog.accept());
  await popup.getByTitle('Remove from ArchiveBox server', { exact: true }).click();
  await expect.poll(async () => Object.keys(await copies())).toEqual([first_id]);
  expect((await api('/api/v1/core/snapshot/' + first_copy.snapshot_id)).url).toBe(url);
  const removed = await fetch(second_server + '/api/v1/crawls/crawl/' + second_copy.crawl_id, { headers: { Authorization: 'Bearer ' + second_key } });
  expect(removed.status).toBe(404);
  await config(); await retention.selectOption('60000');
  await expect.poll(async () => (await readEntries()).length, { timeout: 15000 }).toBe(0);
  expect((await api('/api/v1/core/snapshot/' + first_copy.snapshot_id)).url).toBe(url);
  console.log('PASS: two real collections, independent server-assigned IDs and personas, real screenshot uploads to both, stable profile identity after key edits/reload, popup deletion isolated to one server, and retention gated by every remaining destination.');
} finally {
  await browser?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve)); chrome.kill(); await exited;
  }
  await rm(profile, { recursive: true, force: true });
}
