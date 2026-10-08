// Requires a disposable real ArchiveBox server, with no capture workers.
// ARCHIVEBOX_TEST_SERVER=http://localhost:18860 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-auto-archive-live.mjs
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { launchExtension } from '../tests/helpers/extension.ts';

const serverUrl = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
if (!serverUrl || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE for a disposable server.');
const key = (await readFile(keyFile, 'utf8')).trim();
async function serverSnapshots(url) {
  const response = await fetch(`${serverUrl}/api/v1/core/snapshots?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()).items;
}
const document = await readFile(new URL('../tests/fixtures/auto-archive.html', import.meta.url));
const source = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(document);
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${source.address().port}`;
const harness = await launchExtension(['tabs', 'scripting'], ['<all_urls>']);
try {
  const { context, id } = harness;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByRole('button', { name: 'Configuration', exact: true }).click();
  const serverInput = options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  await serverInput.fill(serverUrl);
  await serverInput.blur();
  await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry?.servers[0]?.server)).toBe(serverUrl);
  const keyInput = options.getByPlaceholder('... abcexamplekey1234 ...');
  await keyInput.fill(key);
  await keyInput.blur();
  await expect.poll(() => options.evaluate(async () => Boolean((await chrome.storage.local.get('server_registry')).server_registry?.servers[0]?.token))).toBe(true);
  for (const label of ['Save viewport screenshots locally', 'Save MHTML snapshots locally', 'Upload viewport screenshots to server', 'Upload full-page screenshots to server', 'Upload MHTML snapshots to server']) {
    const checkbox = options.getByLabel(label, { exact: true });
    if (await checkbox.isChecked()) await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  }
  const fullPage = options.getByLabel('Save full-page screenshots locally', { exact: true });
  const enabled = options.getByLabel('Enable automatic archiving', { exact: true });
  const field = label => options.locator('.field').filter({ has: options.getByText(label, { exact: true }) }).locator('input');
  await field('Match URL regex').fill('.*');
  await enabled.click();
  await expect(enabled).toBeChecked();
  const entries = () => options.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const submitted = [];
  context.on('request', request => {
    if (request.url() === serverUrl + '/api/v1/cli/add' && request.method() === 'POST') submitted.push(...request.postDataJSON().urls);
  });
  const target = await context.newPage();
  const positive = `${origin}/allowed-${Date.now()}`;
  await target.goto(positive);
  await expect.poll(async () => (await entries()).find(entry => entry.url === positive)?.remote_copies).toBeTruthy();
  await expect.poll(() => submitted.includes(positive)).toBe(true);
  const positiveEntry = (await entries()).find(entry => entry.url === positive);
  await expect.poll(async () => (await entries()).find(entry => entry.url === positive)?.remote_copies?.[Object.keys(positiveEntry.remote_copies)[0]]?.snapshot_id).toBeTruthy();
  expect(await serverSnapshots(positive)).toEqual([expect.objectContaining({ url: positive, status: 'queued' })]);
  console.log('Real automatic submission succeeded before changing settings.');
  // Reproduce the report's steady state with captures disabled and patterns
  // entered through the UI, reloaded from storage, then used on later visits.
  for (const pattern of ['.*', '(.*)', '127\\.0\\.0\\.1', '(private|excluded)', '[']) {
    await field('Exclude URL regex').fill('');
    await field('Exclude URL regex').pressSequentially(pattern);
    await options.reload();
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(field('Exclude URL regex')).toHaveValue(pattern);
    for (let visit = 0; visit < 2; visit += 1) {
      const url = `${origin}/excluded-${visit}-${Date.now()}`;
      await target.goto(url);
      await options.waitForTimeout(1000);
      expect((await entries()).some(entry => entry.url === url)).toBe(false);
      expect(submitted).not.toContain(url);
      expect(await serverSnapshots(url)).toEqual([]);
    }
    console.log(`PASS: saved exclusion ${JSON.stringify(pattern)} blocks subsequent navigation.`);
  }
  await field('Exclude URL regex').fill('(.*)');
  const workerCdp = await context.newCDPSession(options);
  await workerCdp.send('ServiceWorker.enable');
  await workerCdp.send('ServiceWorker.stopAllWorkers');
  expect((await options.evaluate(server => chrome.runtime.sendMessage({ type: 'test_server_url', server }), serverUrl)).ok).toBe(true);
  const afterRestart = `${origin}/excluded-after-restart-${Date.now()}`;
  await target.goto(afterRestart);
  await options.waitForTimeout(1000);
  expect((await entries()).some(entry => entry.url === afterRestart)).toBe(false);
  expect(await serverSnapshots(afterRestart)).toEqual([]);
  await field('Exclude URL regex').fill('');
  const resumed = `${origin}/allowed-after-restart-${Date.now()}`;
  await target.goto(resumed);
  await expect.poll(async () => (await serverSnapshots(resumed)).length).toBe(1);
  console.log('PASS: worker restart preserves exclusions; clearing the exclusion resumes automatic submission.');
  await options.evaluate(() => {
    window.captureProgress = [];
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'screenshot_capture_progress') window.captureProgress.push(message);
    });
  });
  await fullPage.click();
  await expect(fullPage).toBeChecked();
  const blocked = [];
  for (const setting of ['disable', 'exclude', 'match', 'invalid-exclude']) {
    await field('Exclude URL regex').fill('');
    await field('Match URL regex').fill('.*');
    if (!(await enabled.isChecked())) { await enabled.click(); await expect(enabled).toBeChecked(); }
    const url = `${origin}/${setting}-${Date.now()}`;
    await target.goto(url);
    await expect.poll(async () => (await entries()).find(entry => entry.url === url)?.id).toBeTruthy();
    const snapshot = (await entries()).find(entry => entry.url === url);
    const progress = () => options.evaluate(id => window.captureProgress.filter(message => message.snapshot_id === id), snapshot.id);
    await expect.poll(async () => (await progress()).some(message => message.phase === 'scrolling')).toBe(true);
    if (setting === 'exclude') await field('Exclude URL regex').fill('.*');
    else if (setting === 'match') await field('Match URL regex').fill('never-match-this-page');
    else if (setting === 'invalid-exclude') await field('Exclude URL regex').fill('[');
    else { await enabled.click(); await expect(enabled).not.toBeChecked(); }
    await expect.poll(async () => (await progress()).some(message => ['done', 'canceled'].includes(message.phase)), { timeout: 30000 }).toBe(true);
    await options.waitForTimeout(1500);
    expect(submitted, `No automatic submission may start after ${setting}`).not.toContain(url);
    expect((await entries()).find(entry => entry.id === snapshot.id)?.remote_copies).toBeUndefined();
    expect(await serverSnapshots(url)).toEqual([]);
    const later = `${origin}/${setting}-later-${Date.now()}`;
    await target.goto(later);
    await options.waitForTimeout(1000);
    expect((await entries()).some(entry => entry.url === later)).toBe(false);
    expect(submitted).not.toContain(later);
    expect(await serverSnapshots(later)).toEqual([]);
    blocked.push(url);
    console.log(`PASS: ${setting} during a real full-page capture prevented submission.`);
  }
  // Exclusion rules do not revoke an explicit Save/Sync action.
  await options.getByRole('button', { name: 'Saved URLs', exact: true }).click();
  await options.locator('.saved-url-table tbody tr').filter({ hasText: blocked[1] }).locator('input[type="checkbox"]').check();
  await options.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(async () => (await serverSnapshots(blocked[1])).length).toBe(1);
  console.log('PASS: explicitly syncing an excluded URL still works.');
} finally {
  await harness.close();
  await new Promise((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
}
