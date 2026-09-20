// Verify a real published Chrome package can be upgraded in place without
// losing its browser storage, OPFS captures, or server-facing state.
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const server = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
const published = process.env.ARCHIVEBOX_PUBLISHED_EXTENSION || '/tmp/archivebox-published-verification/chrome-extracted';
const nextBuild = path.resolve('.output/chrome-mv3');
const published_crx = process.env.ARCHIVEBOX_PUBLISHED_CRX || '/tmp/archivebox-published-verification/archivebox-chrome.crx';
if (!server || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE.');
if (!existsSync(published) || !existsSync(nextBuild)) throw new Error('Published Chrome package or .output/chrome-mv3 is missing.');
const key = (await readFile(keyFile, 'utf8')).trim();
if (!key) throw new Error('ArchiveBox key file is empty.');

const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-upgrade-live-'));
const extensionPath = path.join(profile, 'extension');
const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN ||
  (existsSync('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary')
    ? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' : chromium.executablePath());
const chrome = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run', '--no-default-browser-check',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
let browser;

// Preserve the actual store identity when loading the signed package unpacked.
// CRX3 contains protobuf signing proofs; select the public key for this store ID.
function protobufFields(bytes) {
  let offset = 0;
  const fields = [];
  const number = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const tag = number();
    if ((tag & 7) === 0) number();
    else if ((tag & 7) === 2) { const size = number(); fields.push([tag >> 3, bytes.subarray(offset, offset + size)]); offset += size; }
    else throw new Error('Unexpected CRX3 protobuf wire type.');
  }
  return fields;
}
const store_id = 'habonpimjphpdnmcfkaockjnffodikoj';
const crx = await readFile(published_crx);
expect(crx.toString('ascii', 0, 4)).toBe('Cr24');
expect(crx.readUInt32LE(4)).toBe(3);
const public_keys = protobufFields(crx.subarray(12, 12 + crx.readUInt32LE(8)))
  .filter(([field]) => field === 2 || field === 3).flatMap(([, proof]) => protobufFields(proof))
  .filter(([field]) => field === 1).map(([, key]) => key);
const store_key = public_keys.find((key) => createHash('sha256').update(key).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16))) === store_id);
if (!store_key) throw new Error('Published CRX does not contain the expected store signing key.');

async function api(route) {
  const response = await fetch(server + route, { headers: { Authorization: 'Bearer ' + key } });
  if (!response.ok) throw new Error(`ArchiveBox API returned HTTP ${response.status}`);
  return response.json();
}

try {
  let port = '';
  await expect.poll(async () => {
    port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0]).catch(() => '');
    return port;
  }, { timeout: 15000 }).not.toBe('');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const cdp = await browser.newBrowserCDPSession();
  await cp(published, extensionPath, { recursive: true });
  const oldManifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const oldKey = store_key.toString('base64');
  oldManifest.key = oldKey;
  expect(oldManifest.version).toBe('3.3.2');
  oldManifest.permissions = [...new Set([...(oldManifest.permissions || []), ...(oldManifest.optional_permissions || [])])];
  oldManifest.host_permissions = oldManifest.optional_host_permissions;
  await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(oldManifest));
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  expect(id).toBe(store_id);
  const context = browser.contexts()[0];
  const optionsURL = `chrome-extension://${id}/options.html`;
  let page = await context.newPage();
  await page.goto(optionsURL);

  const storage = () => page.evaluate(async () => chrome.storage.local.get(null));
  const reloadExtension = async () => {
    const installed = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    expect(installed.id).toBe(id);
    page = await context.newPage();
    await page.goto(optionsURL);
  };
  const registry = async () => (await storage()).server_registry;
  const entries = async () => (await storage()).entries || [];
  const opfs = async (paths) => page.evaluate(async (wanted) => {
    const root = await navigator.storage.getDirectory();
    const out = {};
    for (const item of wanted) {
      const segments = item.split('/').filter(Boolean);
      let directory = root;
      for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
      const file = await directory.getFileHandle(segments.at(-1));
      const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
      out[item] = Array.from(bytes);
    }
    return out;
  }, paths);
  const config = async () => page.getByRole('navigation').getByRole('button', { name: 'Configuration', exact: true }).click();
  const serverInput = page.getByPlaceholder(/localhost:.*archivebox\.example\.com/).first();
  const keyInput = page.getByPlaceholder('... abcexamplekey1234 ...').first();
  await config();
  const retention = page.getByLabel('After saving on server, remove local copies after:');
  await serverInput.fill(server); await serverInput.blur();
  await expect.poll(async () => (await storage()).archivebox_server_url, { timeout: 30000 }).toBe(new URL(server).origin);
  await keyInput.fill(key); await keyInput.blur();
  await expect.poll(async () => (await storage()).archivebox_api_key, { timeout: 30000 }).toBe(key);
  if (await retention.count()) await retention.selectOption('never');
  const localScreenshot = page.getByLabel('Save full-page screenshots locally');
  if (!(await localScreenshot.isChecked())) {
    await localScreenshot.click();
    await expect.poll(async () => (await storage()).save_screenshots_locally, { timeout: 10000 }).toBe(true);
  }
  const personaSelect = page.getByLabel('Default Persona');
  const personaAvailable = await personaSelect.count() > 0;
  const persona = personaAvailable
    ? (process.env.ARCHIVEBOX_TEST_PERSONA || (await personaSelect.locator('option').nth(1).getAttribute('value')))
    : null;
  if (personaAvailable && persona && persona !== 'Default') await personaSelect.selectOption(persona);
  const uploadScreenshot = page.getByLabel('Upload screenshots to server');
  if (!(await uploadScreenshot.isChecked())) {
    await uploadScreenshot.click();
    await expect.poll(async () => (await storage()).upload_screenshots_to_server, { timeout: 10000 }).toBe(true);
  }
  const oldConfigured = await storage();
  if (oldConfigured.server_registry !== undefined) throw new Error('Published package unexpectedly already has new server_registry schema.');
  if (oldConfigured.archivebox_server_url !== new URL(server).origin) throw new Error('Published UI did not save the requested server URL.');
  if (oldConfigured.archivebox_api_key !== key) throw new Error('Published UI did not save the requested API key.');

  // Import a genuine CSRF cookie created by the real server's login page, then
  // exercise the published manual-sync consent boundary before upgrading.
  const login = await context.newPage();
  await login.goto(server + '/admin/login/');
  await login.close();
  await page.getByRole('navigation').getByRole('button', { name: 'Cookies', exact: true }).click();
  await page.locator('.toolbar select').selectOption({ label: 'Work' });
  await page.locator('article.persona.active').getByLabel('Timezone', { exact: true }).fill('UTC');
  await page.getByRole('button', { name: 'Load Browser Cookies', exact: true }).click();
  await page.getByPlaceholder('Filter cookie domains').fill(new URL(server).hostname);
  await page.getByRole('checkbox', { name: 'Select all visible cookie domains' }).check();
  await page.getByRole('button', { name: 'Copy Cookies to Profile ⌄', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.locator('article.persona.active').getByRole('button', { name: 'Sync to Server', exact: true }).click();
  await expect.poll(async () => {
    const data = await storage();
    return data['cookieSync:' + data.activePersona]?.pending;
  }).toBe(false);
  const consented = await storage();
  expect(Object.keys(consented.personas.find((item) => item.id === consented.activePersona).cookies)).toContain(new URL(server).hostname);

  const url = `https://example.com/?upgrade-acceptance=${Date.now()}`;
  await page.evaluate(async (value) => chrome.bookmarks.create({ title: 'Upgrade acceptance bookmark', url: value }), url);
  await page.getByRole('navigation').getByRole('button', { name: 'Bulk Import URLs', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Browser Bookmarks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all visible import URLs' }).check();
  await page.getByRole('button', { name: /Import Selected \(1\)/ }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Saved URLs', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all visible URLs' }).check();
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(async () => (await entries()).some((item) => item.url === url), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await api('/api/v1/core/snapshots?limit=100')).items?.some((item) => item.url === url), { timeout: 30000 }).toBe(true);
  const remoteBefore = (await api('/api/v1/core/snapshots?limit=100')).items.find((item) => item.url === url);

  const target = await context.newPage();
  await target.goto(url);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByTitle('Save a screenshot for this URL. Full-page scrolling may ask for optional scripting permission; denying it saves the visible area.').click();
  await expect.poll(async () => (await api('/api/v1/core/snapshot/' + remoteBefore.id)).archiveresults.some((r) => r.plugin === 'chrome_extension_screenshot' && r.status === 'succeeded'), { timeout: 30000 }).toBe(true);
  const oldEntries = await entries();
  const oldEntry = oldEntries.find((item) => item.url === url);
  if (!oldEntry) throw new Error('Published UI did not create the imported bookmark entry.');
  const oldRemoteIDs = [oldEntry.archiveboxCrawlId, oldEntry.archiveboxSnapshotId].filter(Boolean);
  const screenshotPaths = [...new Set(oldEntries.flatMap((item) => [item.screenshot?.path, ...(item.screenshot?.parts || []).map((part) => part.path)].filter(Boolean)))];
  const oldBytes = await opfs(screenshotPaths);
  const oldPersonas = (await storage()).personas || [];
  const oldLocalIDs = oldEntries.map((item) => item.id);
  const oldStorage = await storage();
  await popup.close(); await target.close();
  console.log(`OLD_READY extension=${id} entries=${oldEntries.length} screenshot_bytes=${Object.keys(oldBytes).length} persona=${persona || 'legacy-default'}`);

  // Replace files at the same unpacked path, carrying forward the published key
  // and permissions. Chrome's storage/OPFS origin is keyed by extension ID.
  const nextPath = path.join(profile, 'next');
  await cp(nextBuild, nextPath, { recursive: true });
  const nextManifestPath = path.join(nextPath, 'manifest.json');
  const nextManifest = JSON.parse(await readFile(nextManifestPath, 'utf8'));
  if (oldKey) nextManifest.key = oldKey;
  nextManifest.permissions = [...new Set([...(oldManifest.permissions || []), ...(nextManifest.permissions || []), ...(oldManifest.optional_permissions || [])])];
  nextManifest.host_permissions = oldManifest.host_permissions;
  await writeFile(nextManifestPath, JSON.stringify(nextManifest));
  await rm(extensionPath, { recursive: true, force: true });
  await cp(nextPath, extensionPath, { recursive: true });
  await reloadExtension();
  expect(page.url()).toBe(optionsURL);
  const afterID = id;
  await expect.poll(async () => (await storage()).storage_schema_version).toBe(1);
  const afterStorage = await storage();
  const afterEntries = afterStorage.entries || [];
  const afterRegistry = afterStorage.server_registry;
  expect(afterRegistry.servers).toHaveLength(1);
  expect(afterRegistry.servers[0].server).toBe(new URL(server).origin);
  expect(afterRegistry.servers[0].token).toBe(key);
  const serverID = afterRegistry.servers[0].id;
  if (persona) expect(afterRegistry.servers[0].persona).toBe(persona);
  expect(afterStorage.server_policies[serverID]?.upload_screenshots_to_server).toBe(true);
  expect(afterStorage.entries.map((item) => item.id)).toEqual(oldLocalIDs);
  const migratedRemote = afterEntries.find((item) => item.url === url)?.remote_copies?.[serverID]
    || afterEntries.find((item) => item.url === url)?.unassigned_remote_copy;
  for (const remoteID of oldRemoteIDs) expect([migratedRemote?.crawl_id, migratedRemote?.snapshot_id]).toContain(remoteID);
  expect(afterStorage.personas).toEqual(oldPersonas.map(({ lastUsed, serverPersonaId, serverPersonaUrl, ...persona }) => ({
    ...persona, last_used: lastUsed ?? null,
    ...(serverPersonaId ? { remote_personas: { [serverID]: { id: serverPersonaId, url: serverPersonaUrl } } } : {}),
  })));
  expect(afterStorage.active_persona).toBe(oldStorage.activePersona);
  expect(afterRegistry.servers[0].persona).toBe(oldPersonas.find((persona) => persona.id === oldStorage.activePersona)?.name ?? null);
  const consent = afterStorage['cookie_sync:' + serverID + ':' + oldStorage.activePersona];
  expect(consent.server_id).toBe(serverID);
  expect(consent.persona_id).toBe(oldStorage.activePersona);
  expect(consent.server_origin).toBe(new URL(server).origin);
  expect(consent.domains).toEqual(oldStorage['cookieSync:' + oldStorage.activePersona].domains);
  expect(consent.fingerprint).toBe(oldStorage['cookieSync:' + oldStorage.activePersona].fingerprint);
  expect(Object.keys(afterStorage).filter((key) => key.startsWith('cookie_sync:'))).toHaveLength(1);
  for (const field of ['local_retention_ms', 'save_screenshots_locally', 'ui_language', 'match_urls', 'exclude_urls', 'enable_auto_archive']) {
    if (field in oldStorage) expect(afterStorage[field]).toBe(oldStorage[field]);
  }
  const afterBytes = await opfs(screenshotPaths);
  expect(afterBytes).toEqual(oldBytes);
  await reloadExtension();
  expect(page.url()).toBe(optionsURL);
  expect((await storage()).server_registry.servers[0].id).toBe(serverID);
  expect((await storage()).entries[0].id).toBe(oldLocalIDs[0]);
  console.log(`PASS: published package upgraded in place with stable extension ID ${afterID}, server profile, policy/global preferences, persona data, local IDs, remote copy IDs, and OPFS screenshot bytes across two runtime reloads.`);
} finally {
  await browser?.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve)); chrome.kill(); await exited;
  }
  await rm(profile, { recursive: true, force: true });
}
