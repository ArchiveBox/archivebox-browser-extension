// Real extension UI + ArchiveBox API; no rewritten manifest, fake captures, or HTTP interception.
// ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:5897 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-popup-delivery-live.mjs
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
const profile = process.env.ARCHIVEBOX_TEST_PROFILE || await mkdtemp(path.join(tmpdir(), 'archivebox-popup-delivery-'));
const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN || (existsSync(canary) ? canary : chromium.executablePath());
const extensionPath = path.join(profile, 'extension');
await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
const loadByFlag = executable.endsWith('Google Chrome for Testing');
await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
const chrome = spawn(executable, [`--user-data-dir=${profile}`, ...(loadByFlag ? [`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`] : []), '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', ...(process.env.HEADLESS ? ['--headless=new'] : []), '--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
let browser;
const evidence = await mkdtemp(path.join(tmpdir(), 'archivebox-popup-evidence-'));
async function connectPopup(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onclose = () => { for (const callbacks of pending.values()) callbacks.reject(new Error('Popup closed')); pending.clear(); };
  socket.onmessage = event => { const data = JSON.parse(event.data); if (!data.id) return; const callbacks = pending.get(data.id); pending.delete(data.id); if (data.error) callbacks.reject(new Error(data.error.message)); else callbacks.resolve(data.result); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Popup closed')); return; } const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = async selector => { const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 }); };
  return { send, evaluate, click, close: () => socket.close() };
}
try {
  let port;
  await expect.poll(async () => { port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then(s => s.split('\n')[0]).catch(() => ''); return port; }).not.toBe('');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const cdp = await browser.newBrowserCDPSession();
  let id;
  if (loadByFlag) {
    await expect.poll(async () => { const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()); const worker = targets.find(t => t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js')); id = worker ? new URL(worker.url).host : undefined; return id; }).toBeTruthy();
  } else ({ id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath }));
  const context = browser.contexts()[0];
  let acceptanceTtfbMs;
  context.on('response', response => { if (response.url().endsWith('/api/v1/cli/add')) { const timing = response.request().timing(); acceptanceTtfbMs = timing.responseStart - timing.requestStart; } });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByRole('button', { name: 'Configuration', exact: true }).click();
  await options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').fill(server);
  await options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').blur();
  await expect.poll(() => options.evaluate(async () => ((r) => r?.servers.find(s => s.id === r.active_server_id)?.server)((await chrome.storage.local.get('server_registry')).server_registry))).toBe(server);
  await options.getByPlaceholder('... abcexamplekey1234 ...').fill(key);
  await options.getByPlaceholder('... abcexamplekey1234 ...').blur();
  await expect.poll(() => options.evaluate(async () => ((r) => Boolean(r?.servers.find(s => s.id === r.active_server_id)?.token))((await chrome.storage.local.get('server_registry')).server_registry))).toBe(true);
  await options.bringToFront();
  const optionsWindowId = await options.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.windows.update(tab.windowId, { focused: true }); return tab.windowId; });
  await expect.poll(() => options.evaluate(async id => (await chrome.windows.get(id)).focused, optionsWindowId), { timeout: 60000 }).toBe(true);
  if (!await options.evaluate(async () => chrome.permissions.contains({ origins: ['<all_urls>'], permissions: ['tabs'] }))) await options.getByRole('button', { name: 'Request all permissions', exact: true }).click();
  await expect.poll(() => options.evaluate(async () => chrome.permissions.contains({ origins: ['<all_urls>'], permissions: ['tabs'] })), { timeout: 60000 }).toBe(true);
  for (const [label, enabled] of [
    ['Save full-page screenshots locally', Boolean(process.env.FULLPAGE)],
    ['Upload full-page screenshots to server', Boolean(process.env.FULLPAGE_UPLOAD)],
  ]) {
    const checkbox = options.getByLabel(label, { exact: true });
    if (await checkbox.isChecked() !== enabled) await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: enabled });
  }
  const url = 'https://example.com/?archivebox_popup_delivery=' + Date.now();
  const target = await context.newPage();
  const targetSession = await context.newCDPSession(target);
  const { targetInfo } = await targetSession.send('Target.getTargetInfo');
  const { windowId: targetWindowId } = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
  await cdp.send('Browser.setWindowBounds', { windowId: targetWindowId, bounds: { width: 1100, height: 360 } });
  await target.goto(url);
  await target.bringToFront();
  const originalScroll = await target.evaluate(() => ({ x: scrollX, y: scrollY }));
  const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const openAt = performance.now();

  const windowId = await options.evaluate(async (url) => { const [tab] = await chrome.tabs.query({ url }); await chrome.windows.update(tab.windowId, { focused: true }); return tab.windowId; }, url);
  await expect.poll(() => options.evaluate(async id => (await chrome.windows.get(id)).focused, windowId)).toBe(true);
  await options.evaluate(windowId => chrome.action.openPopup({ windowId }), windowId);
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  const popupTarget = targets.find(t => t.url === `chrome-extension://${id}/popup.html`);
  expect(popupTarget).toBeTruthy();
  const popup = await connectPopup(popupTarget.webSocketDebuggerUrl);
  await popup.evaluate(`window.testStatusHistory = []; const recordStatus = () => { const text = document.querySelector('.archivebox-overlay__states')?.textContent || ''; if (window.testStatusHistory.at(-1) !== text) window.testStatusHistory.push(text); }; new MutationObserver(recordStatus).observe(document.documentElement, { subtree: true, childList: true, characterData: true }); recordStatus();`);
  await expect.poll(() => popup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent'), { timeout: 10000 }).toContain('Submitted to ArchiveBox Server');
  const acceptedMs = performance.now() - openAt;
  console.log(JSON.stringify({ event: 'accepted', acceptedMs, acceptanceTtfbMs, url }));
  const entries = () => options.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const serverId = await options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry.active_server_id);
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
  const saved = (await entries()).find(e => e.url === url);
  expect(saved.viewport_screenshot).toBeTruthy();
  expect(saved.mhtml).toBeTruthy();
  expect(saved.remote_copies[serverId].delivery_error).toBeUndefined();
  expect(saved.viewport_screenshot.parts?.length || 1).toBe(1);
  // captureVisibleTab uses the native backing scale even when CDP emulates CSS pixels.
  const backingScale = saved.viewport_screenshot.width / viewport.width;
  expect(backingScale).toBeGreaterThanOrEqual(1);
  expect(saved.viewport_screenshot.height).toBe(viewport.height * backingScale);
  if (process.env.FULLPAGE) {
    expect(saved.screenshot).toBeTruthy();
    expect(saved.screenshot.path).not.toBe(saved.viewport_screenshot.path);
    expect(saved.screenshot.height).toBeGreaterThan(saved.viewport_screenshot.height);
  } else expect(saved.screenshot).toBeUndefined();
  expect(await target.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(originalScroll);
  console.log(JSON.stringify({ event: 'complete', elapsedMs: performance.now() - openAt, screenshot: saved.viewport_screenshot, mhtml: saved.mhtml, remote: saved.remote_copies[serverId] }));
  await popup.click('input[placeholder="+ tag"]');
  await popup.send('Input.insertText', { text: 'fresh-submission-regression' });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await expect.poll(() => popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).toContain('Submitted');
  expect(await popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Previously submitted');
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.tags).toContain('fresh-submission-regression');
  await popup.click('.archivebox-tag-chip--current .archivebox-tag-chip__remove');
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.tags).not.toContain('fresh-submission-regression');
  expect(await popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Previously submitted');
  const screenshot = await popup.send('Page.captureScreenshot');
  await writeFile(path.join(evidence, 'fresh-popup.png'), Buffer.from(screenshot.data, 'base64'));
  const statusHistory = await popup.evaluate('window.testStatusHistory');
  expect(statusHistory.some(text => text.includes('Previously submitted'))).toBe(false);
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
  await expect.poll(async () => (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).some(t => t.id === popupTarget.id)).toBe(false);
  popup.close();
  await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); }, windowId);
  await expect.poll(() => options.evaluate(async id => (await chrome.windows.get(id)).focused, windowId)).toBe(true);
  await options.evaluate(windowId => chrome.action.openPopup({ windowId }), windowId);
  const reopenedTargets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  const reopenedTarget = reopenedTargets.find(t => t.url === `chrome-extension://${id}/popup.html`);
  expect(reopenedTarget).toBeTruthy();
  const reopened = await connectPopup(reopenedTarget.webSocketDebuggerUrl);
  await expect.poll(() => reopened.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).toContain('Submitted');
  expect(await reopened.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Previously submitted');
  await reopened.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
  reopened.close();
  const crawlsResponse = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } });
  expect(crawlsResponse.ok).toBe(true);
  const crawls = await crawlsResponse.json();
  expect(crawls.filter(c => c.urls.split('\n').includes(url))).toHaveLength(1);
  const remoteResponse = await fetch(server + '/api/v1/core/snapshot/' + saved.remote_copies[serverId].snapshot_id, { headers: { Authorization: 'Bearer ' + key } });
  expect(remoteResponse.ok).toBe(true);
  const remote = await remoteResponse.json();
  const remoteViewport = remote.archiveresults.find(r => r.plugin === 'chrome_extension_viewport');
  const remoteMhtml = remote.archiveresults.find(r => r.plugin === 'chrome_mhtml');
  const remoteFullpage = remote.archiveresults.find(r => r.plugin === 'chrome_extension_screenshot');
  expect(remoteViewport?.status).toBe('succeeded');
  expect(remoteViewport.output_files['screenshot.png'].size).toBeGreaterThan(100);
  expect(remoteMhtml?.status).toBe('succeeded');
  expect(remoteMhtml.output_files['snapshot.mhtml'].size).toBe(saved.mhtml.size);
  if (process.env.FULLPAGE_UPLOAD) expect(remoteFullpage?.status).toBe('succeeded');
  else expect(remoteFullpage).toBeUndefined();
  for (const [artifact, plugin] of [[saved.viewport_screenshot, 'chrome_extension_viewport'], [saved.mhtml, 'chrome_mhtml'], ...(process.env.FULLPAGE_UPLOAD ? [[saved.screenshot, 'chrome_extension_screenshot']] : [])]) {
    const parts = artifact.parts?.length ? artifact.parts : [{ path: artifact.path }];
    for (const part of parts) {
      const localBytes = await options.evaluate(async filePath => {
        const segments = filePath.split('/'); const name = segments.pop(); let directory = await navigator.storage.getDirectory();
        for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
        const file = await (await directory.getFileHandle(name)).getFile(); return [...new Uint8Array(await file.arrayBuffer())];
      }, part.path);
      const replayUrl = server + '/' + remote.archive_path + '/' + plugin + '/' + part.path.split('/').at(-1);
      const replay = await fetch(replayUrl, { headers: { Authorization: 'Bearer ' + key } });
      expect(replay.ok).toBe(true);
      expect(Buffer.from(await replay.arrayBuffer()).equals(Buffer.from(localBytes))).toBe(true);
    }
  }
  if (process.env.AGE_CHECK) {
    const after = Date.parse(saved.remote_copies[serverId].submitted_at) + 121000;
    while (Date.now() < after) { console.log(JSON.stringify({ event: 'waiting-real-receipt-age', remainingMs: after - Date.now() })); await new Promise(resolve => setTimeout(resolve, Math.min(30000, after - Date.now()))); }
    await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); }, windowId);
    await expect.poll(() => options.evaluate(async id => (await chrome.windows.get(id)).focused, windowId)).toBe(true);
    await options.evaluate(windowId => chrome.action.openPopup({ windowId }), windowId);
    const agedTarget = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
    const aged = await connectPopup(agedTarget.webSocketDebuggerUrl);
    await expect.poll(() => aged.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).toContain('Previously submitted');
    aged.close();
    const afterCrawls = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
    expect(afterCrawls.filter(c => c.urls.split('\n').includes(url))).toHaveLength(1);
  }
  const report = { statusHistory, acceptanceTtfbMs, acceptedMs, elapsedMs: performance.now() - openAt, saved, remote, fullpage: Boolean(process.env.FULLPAGE), fullpageUpload: Boolean(process.env.FULLPAGE_UPLOAD) };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ event: 'verified', acceptanceTtfbMs, evidence, plugins: remote.archiveresults.map(r => r.plugin), fullpage: report.fullpage, fullpageUpload: report.fullpageUpload }));
} finally {
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    if (browser?.isConnected()) await (await browser.newBrowserCDPSession()).send('Browser.close');
    else chrome.kill('SIGTERM');
    await exited;
  }
  await browser?.close();
  if (!process.env.ARCHIVEBOX_TEST_PROFILE) await rm(profile, { recursive: true, force: true });
}
