// Real Chrome + published ArchiveBox 0.7.4 compatibility acceptance.
// The server is expected at ARCHIVEBOX_TEST_LEGACY_SERVER and the disposable
// container at ARCHIVEBOX_TEST_LEGACY_CONTAINER.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = process.env.ARCHIVEBOX_TEST_LEGACY_SERVER || 'http://127.0.0.1:18773';
const container = process.env.ARCHIVEBOX_TEST_LEGACY_CONTAINER || 'archivebox-multiserver-legacy';
const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-legacy-live-'));
const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN
  || (existsSync(canary) ? canary : chromium.executablePath());
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run', '--no-default-browser-check',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
let browser;
async function legacyCount() {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '--user', 'archivebox', container, 'archivebox', 'list', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output)));
  });
  return JSON.parse(result).length;
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
  manifest.permissions.push('bookmarks', 'tabs', 'scripting', 'pageCapture');
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  const context = browser.contexts()[0];
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByRole('navigation').getByRole('button', { name: 'Configuration', exact: true }).click();
  await options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').fill(server);
  await options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').blur();
  await expect.poll(async () => (await options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry))?.servers?.[0]?.server).toBe(server);
  const registry = await options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry);
  const server_id = registry.servers[0].id;
  const website = await context.newPage();
  const url = `https://example.com/?archivebox-legacy=${Date.now()}`;
  await website.goto(url);
  await website.bringToFront();
  const before = await legacyCount();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByText(/Submitted to ArchiveBox Server at depth 0/)).toBeVisible({ timeout: 30000 });
  await expect.poll(legacyCount, { timeout: 30000 }).toBe(before + 1);
  const entry = await popup.evaluate(async () => (await chrome.storage.local.get('entries')).entries.at(-1));
  expect(entry.url).toBe(url);
  expect(entry.remote_copies[server_id].status).toBe('accepted');
  expect(entry.remote_copies[server_id].crawl_id).toBeUndefined();
  expect(entry.remote_copies[server_id].snapshot_id).toBeUndefined();
  await popup.reload();
  await expect(popup.getByText('Previously submitted. Server status has not been checked in this session.', { exact: true })).toBeVisible();
  await expect.poll(legacyCount, { timeout: 5000 }).toBe(before + 1);
  console.log('PASS: real Chrome popup submitted to ArchiveBox 0.7.4 /add/, accepted HTML success without inventing crawl or snapshot IDs, and reload did not duplicate the legacy submission.');
} finally {
  await browser?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve)); chrome.kill(); await exited;
  }
  await rm(profile, { recursive: true, force: true });
}
