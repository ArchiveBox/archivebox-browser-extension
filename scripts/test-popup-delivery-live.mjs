// Real extension UI + ArchiveBox API; no rewritten manifest, fake captures, or HTTP interception.
// ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:5897 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-popup-delivery-live.mjs
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const server = process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
if (!server || !keyFile) throw new Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE for a disposable real server.');
const key = (await readFile(keyFile, 'utf8')).trim();
const oldInterface = Boolean(process.env.OLD_SERVER);
if (oldInterface) {
  const schema = await fetch(server + '/api/v1/openapi.json', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
  expect(schema.components.schemas.SnapshotSchema.properties.crawl_id).toBeUndefined();
  expect(schema.components.schemas.SnapshotSchema.properties.persona).toBeUndefined();
}
let testPersona;
const personaUserAgent = 'ArchiveBox popup persona test ' + Date.now();
if (process.env.PERSONA_TEST) {
  const response = await fetch(server + '/api/v1/personas/sync', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extension_persona_id: crypto.randomUUID(), name: 'zzzz Popup test ' + Date.now(), settings: { user_agent: personaUserAgent } }),
  });
  expect(response.ok).toBe(true);
  testPersona = (await response.json()).persona;
}

const profile = process.env.ARCHIVEBOX_TEST_PROFILE || await mkdtemp(path.join(tmpdir(), 'archivebox-popup-delivery-'));
const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN || (existsSync(canary) ? canary : chromium.executablePath());
const extensionPath = path.join(profile, 'extension');
await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
const loadByFlag = executable.endsWith('Google Chrome for Testing');
await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
const chrome = spawn(executable, [`--user-data-dir=${profile}`, ...(loadByFlag ? [`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`] : []), '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', ...(process.env.HEADLESS ? ['--headless=new'] : []), '--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
let browser;
let verified = false;
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
  const extensions = await context.newPage();
  await extensions.goto(`chrome://extensions/?id=${id}`);
  await extensions.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect.poll(async () => (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).some(t => t.url === `chrome-extension://${id}/background.js`)).toBe(true);
  await extensions.close();
  const addRequests = [];
  const lookupRequests = [];
  const deleteRequests = [];
  const recordLookups = async popup => lookupRequests.push(...await popup.evaluate(`performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith(${JSON.stringify(server + '/api/v1/core/snapshots?')}))`));
  context.on('request', request => {
    if (request.method() === 'DELETE') deleteRequests.push(request.url());
    if (request.url().endsWith('/api/v1/cli/add')) {
      const body = request.postDataJSON();
      addRequests.push({ only_new: body.only_new, depth: body.depth, persona: body.persona });
      console.log(JSON.stringify({ event: 'add-request', only_new: body.only_new, depth: body.depth }));
    }
  });
  let acceptanceTtfbMs;
  context.on('response', response => { if (acceptanceTtfbMs === undefined && response.url().endsWith('/api/v1/cli/add')) { const timing = response.request().timing(); acceptanceTtfbMs = timing.responseStart - timing.requestStart; } });
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
  await target.evaluate(() => { window.testPageInput = []; for (const kind of ['keydown', 'wheel', 'scroll']) addEventListener(kind, event => window.testPageInput.push({ kind, key: event.key, trusted: event.isTrusted, x: scrollX, y: scrollY })); });
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
  await expect.poll(() => popup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent'), { timeout: 10000 }).toBe('Submitted');
  const acceptedMs = performance.now() - openAt;
  console.log(JSON.stringify({ event: 'accepted', acceptedMs, acceptanceTtfbMs, url }));
  for (const seconds of [1, 2]) {
    await expect.poll(() => popup.evaluate(`window.testStatusHistory.some(text => text.includes('Submitted ${seconds}s ago'))`), { intervals: [100], timeout: 5000 }).toBe(true);
  }
  expect(addRequests).toHaveLength(1);
  expect(await popup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent')).toBe('Submitted');
  const entries = () => options.evaluate(async () => (await chrome.storage.local.get('entries')).entries || []);
  const serverId = await options.evaluate(async () => (await chrome.storage.local.get('server_registry')).server_registry.active_server_id);
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
  const saved = (await entries()).find(e => e.url === url);
  const controls = await popup.evaluate(`['.archivebox-overlay__capture-actions button', '.archivebox-overlay__crawl-button', 'button[aria-label="Persona"]'].map(selector => { const element = document.querySelector(selector); const rect = element.getBoundingClientRect(); return { top: rect.top, left: rect.left, right: rect.right, text: element.textContent }; })`);
  expect(controls[0].top).toBe(controls[1].top);
  expect(controls[1].top).toBe(controls[2].top);
  expect(controls[2].left).toBeGreaterThan(controls[1].right);
  expect(controls[2].right).toBeLessThanOrEqual(await popup.evaluate('innerWidth'));
  expect(controls[2].text).toContain('👤');

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
  const pageInput = await target.evaluate(() => window.testPageInput);
  if (pageInput.length) console.log(JSON.stringify({ event: 'captured-page-input', pageInput }));
  expect(await target.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(originalScroll);
  console.log(JSON.stringify({ event: 'complete', elapsedMs: performance.now() - openAt, screenshot: saved.viewport_screenshot, mhtml: saved.mhtml, remote: saved.remote_copies[serverId] }));
  await popup.click('input[placeholder="+ tag"]');
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
  await popup.send('Input.insertText', { text: 'fresh-submission-regression' });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await expect.poll(() => popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).toContain('Submitted');
  expect(await popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Submitted 2 minutes ago');
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.tags).toContain('fresh-submission-regression');
  await popup.click('button[title="Remove tag fresh-submission-regression"]');
  await expect.poll(async () => (await entries()).find(e => e.url === url)?.tags).not.toContain('fresh-submission-regression');
  expect(await popup.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Submitted 2 minutes ago');
  const screenshot = await popup.send('Page.captureScreenshot');
  await writeFile(path.join(evidence, 'fresh-popup.png'), Buffer.from(screenshot.data, 'base64'));
  const statusHistory = await popup.evaluate('window.testStatusHistory');
  expect(statusHistory.some(text => text.includes('Previously submitted'))).toBe(false);
  await recordLookups(popup);
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
  expect(await reopened.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).not.toContain('Submitted 2 minutes ago');
  await recordLookups(reopened);
  await reopened.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
  reopened.close();
  expect(lookupRequests).toHaveLength(0);
  const crawlsResponse = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } });
  expect(crawlsResponse.ok).toBe(true);
  const crawls = await crawlsResponse.json();
  expect(crawls.filter(c => c.urls.split('\n').includes(url))).toHaveLength(1);
  const remoteResponse = await fetch(server + '/api/v1/core/snapshot/' + saved.remote_copies[serverId].snapshot_id, { headers: { Authorization: 'Bearer ' + key } });
  expect(remoteResponse.ok).toBe(true);
  const remote = await remoteResponse.json();
  const remoteViewport = remote.archiveresults.find(r => r.plugin === 'chrome_extension_viewport');
  const remoteMhtml = remote.archiveresults.find(r => r.plugin === 'chrome_extension_mhtml');
  const remoteFullpage = remote.archiveresults.find(r => r.plugin === 'chrome_extension_screenshot');
  expect(remoteViewport?.status).toBe('succeeded');
  expect(remoteViewport.output_files['screenshot.png'].size).toBeGreaterThan(100);
  expect(remoteMhtml?.status).toBe('succeeded');
  expect(remoteMhtml.output_files['snapshot.mhtml'].size).toBe(saved.mhtml.size);
  if (process.env.FULLPAGE_UPLOAD) expect(remoteFullpage?.status).toBe('succeeded');
  else expect(remoteFullpage).toBeUndefined();
  for (const [artifact, plugin] of [[saved.viewport_screenshot, 'chrome_extension_viewport'], [saved.mhtml, 'chrome_extension_mhtml'], ...(process.env.FULLPAGE_UPLOAD ? [[saved.screenshot, 'chrome_extension_screenshot']] : [])]) {
    const parts = artifact.parts?.length ? artifact.parts : [{ path: artifact.path }];
    for (const part of parts) {
      const localBytes = await options.evaluate(async filePath => {
        const segments = filePath.split('/'); const name = segments.pop(); let directory = await navigator.storage.getDirectory();
        for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
        const file = await (await directory.getFileHandle(name)).getFile(); return [...new Uint8Array(await file.arrayBuffer())];
      }, part.path);
      // /snapshot/{id} lets the server choose the public replay origin in either security mode.
      const replayUrl = server + '/snapshot/' + encodeURIComponent(remote.id) + '/' + plugin + '/' + encodeURIComponent(part.path.split('/').at(-1));
      const replay = await fetch(replayUrl, { headers: { Authorization: 'Bearer ' + key } });
      expect(replay.ok).toBe(true);
      expect(Buffer.from(await replay.arrayBuffer()).equals(Buffer.from(localBytes))).toBe(true);
    }
  }
  let lastPopup;
  let expectedCrawls = 1;
  let staleDeletionReplacement;
  if (process.env.AGE_CHECK) {
    const after = Date.parse(saved.remote_copies[serverId].submitted_at) + 121000;
    while (Date.now() < after) { console.log(JSON.stringify({ event: 'waiting-real-receipt-age', remainingMs: after - Date.now() })); await new Promise(resolve => setTimeout(resolve, Math.min(30000, after - Date.now()))); }
    await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); }, windowId);
    await expect.poll(() => options.evaluate(async id => (await chrome.windows.get(id)).focused, windowId)).toBe(true);
    await options.evaluate(windowId => chrome.action.openPopup({ windowId }), windowId);
    const agedTarget = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
    const aged = await connectPopup(agedTarget.webSocketDebuggerUrl);
    await expect.poll(() => aged.evaluate('document.querySelector(".archivebox-overlay__states")?.textContent')).toContain('Submitted 2 minutes ago');
    await recordLookups(aged);
    expect(lookupRequests).toHaveLength(1);
    expect(new URL(lookupRequests[0]).searchParams.get('url')).toBe(url);
    expect((await entries()).find(e => e.url === url).remote_copies[serverId].submitted_at).toBe(saved.remote_copies[serverId].submitted_at);
    await writeFile(path.join(evidence, 'aged-popup.png'), Buffer.from((await aged.send('Page.captureScreenshot')).data, 'base64'));
    lastPopup = aged;
    const afterCrawls = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
    expect(afterCrawls.filter(c => c.urls.split('\n').includes(url))).toHaveLength(1);
  }
  if (process.env.DELETE_AFTER_AGE) {
    if (!lastPopup) throw new Error('DELETE_AFTER_AGE requires AGE_CHECK=1.');
    await lastPopup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined);
    lastPopup.close();
    const removed = await fetch(server + '/api/v1/core/snapshot/' + saved.remote_copies[serverId].snapshot_id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + key } });
    expect(removed.ok).toBe(true);
    expect((await removed.json()).queued_count).toBe(1);
    await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); await chrome.action.openPopup({ windowId }); }, windowId);
    const replacementTarget = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
    lastPopup = await connectPopup(replacementTarget.webSocketDebuggerUrl);
    await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.crawl_id).not.toBe(saved.remote_copies[serverId].crawl_id);
    await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
    staleDeletionReplacement = (await entries()).find(e => e.url === url).remote_copies[serverId];
    expect(staleDeletionReplacement.snapshot_id).not.toBe(saved.remote_copies[serverId].snapshot_id);
    await recordLookups(lastPopup);
    expect(lookupRequests).toHaveLength(2);
    await expect.poll(() => lastPopup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent')).toBe('Submitted');
    expectedCrawls++;
  }
  if (process.env.REUSE_LOCAL) {
    await expect.poll(async () => (await fetch(server + '/api/v1/crawls/crawl/' + saved.remote_copies[serverId].crawl_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json())).status, { timeout: 60000 }).toBe('sealed');
    const oldCapture = await fetch(server + '/api/v1/core/snapshot/' + saved.remote_copies[serverId].snapshot_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
    await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); await chrome.action.openPopup({ windowId }); }, windowId);
    const opened = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
    lastPopup = await connectPopup(opened.webSocketDebuggerUrl);
    await expect.poll(() => lastPopup.evaluate(`document.querySelector('button[title="Remove from local saved URLs"]').disabled`)).toBe(false);
    await lastPopup.click('button[title="Remove from local saved URLs"]');
    await expect.poll(async () => (await entries()).some(item => item.url === url)).toBe(false);
    await expect.poll(async () => (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).some(t => t.url === `chrome-extension://${id}/popup.html`)).toBe(false);
    lastPopup.close();
    await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); await chrome.action.openPopup({ windowId }); }, windowId);
    const reopened = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
    lastPopup = await connectPopup(reopened.webSocketDebuggerUrl);
    await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
    const reusedLocal = (await entries()).find(e => e.url === url);
    expect(reusedLocal.id).not.toBe(saved.id);
    expect(reusedLocal.viewport_screenshot.path).not.toBe(saved.viewport_screenshot.path);
    expect(reusedLocal.mhtml.path).not.toBe(saved.mhtml.path);
    expect(reusedLocal.remote_copies[serverId].snapshot_id).toBe(saved.remote_copies[serverId].snapshot_id);
    expect(reusedLocal.remote_copies[serverId].snapshot_crawl_id).toBe(saved.remote_copies[serverId].crawl_id);
    expect(reusedLocal.remote_copies[serverId].crawl_id).not.toBe(saved.remote_copies[serverId].crawl_id);
    expect(await fetch(server + '/api/v1/core/snapshot/' + saved.remote_copies[serverId].snapshot_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json())).toEqual(oldCapture);
    expectedCrawls++;
  }
  async function chooseDepth(value) {
    await lastPopup.click('.archivebox-overlay__crawl-button');
    await lastPopup.click(`.archivebox-overlay__crawl-menu button:nth-child(${value + 1})`);
    await expect.poll(() => lastPopup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent')).toBe(`Submitted + will crawl URLs ${value} ${value === 1 ? 'hop' : 'hops'} out`);
    const layout = await lastPopup.evaluate(`(() => {const crawl = document.querySelector('.archivebox-overlay__crawl-button'); const persona = document.querySelector('button[aria-label="Persona"]'); const capture = document.querySelector('.archivebox-overlay__capture-actions button'); return { crawlWidth: crawl.clientWidth, textWidth: crawl.scrollWidth, text: crawl.textContent, crawlTop: crawl.getBoundingClientRect().top, personaTop: persona.getBoundingClientRect().top, captureTop: capture.getBoundingClientRect().top, personaRight: persona.getBoundingClientRect().right, width: innerWidth };})()`);
    expect(layout.text).toContain(String(value));
    expect(layout.textWidth).toBeLessThanOrEqual(layout.crawlWidth);
    expect(layout.crawlTop).toBe(layout.personaTop);
    expect(layout.crawlTop).toBe(layout.captureTop);
    expect(layout.personaRight).toBeLessThanOrEqual(layout.width);
    await writeFile(path.join(evidence, `depth-${value}-popup.png`), Buffer.from((await lastPopup.send('Page.captureScreenshot')).data, 'base64'));
  }
  let resubmission;
  let personaSubmission;
  if (process.env.RESUBMIT || testPersona) {
    if (!lastPopup) {
      await options.evaluate(async windowId => { await chrome.windows.update(windowId, { focused: true }); await chrome.action.openPopup({ windowId }); }, windowId);
      const lastTarget = (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())).find(t => t.url === `chrome-extension://${id}/popup.html`);
      lastPopup = await connectPopup(lastTarget.webSocketDebuggerUrl);
    }
    await expect.poll(() => lastPopup.evaluate('Boolean(document.querySelector(".archivebox-overlay__resubmit"))')).toBe(Boolean(process.env.AGE_CHECK));
    if (testPersona) {
      const beforePersona = (await entries()).find(e => e.url === url).remote_copies[serverId];
      const globalPersona = await options.evaluate(async serverId => (await chrome.storage.local.get('server_registry')).server_registry.servers.find(s => s.id === serverId).persona, serverId);
      await expect.poll(() => lastPopup.evaluate(`document.querySelector('button[aria-label="Persona"]').disabled`)).toBe(false);
      await lastPopup.click('button[aria-label="Persona"]');
      await expect.poll(() => lastPopup.evaluate(`Boolean(document.querySelector('[data-persona=${JSON.stringify(testPersona.name)}]'))`)).toBe(true);
      await writeFile(path.join(evidence, 'persona-menu.png'), Buffer.from((await lastPopup.send('Page.captureScreenshot')).data, 'base64'));
      const { root } = await lastPopup.send('DOM.getDocument');
      const { nodeId } = await lastPopup.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-persona=${JSON.stringify(testPersona.name)}]` });
      await lastPopup.send('DOM.scrollIntoViewIfNeeded', { nodeId });
      const personaStart = performance.now();
      await lastPopup.click(`[data-persona=${JSON.stringify(testPersona.name)}]`);
      await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.persona, { timeout: 5000 }).toBe(testPersona.name);
      await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
      personaSubmission = (await entries()).find(e => e.url === url).remote_copies[serverId];
      console.log(JSON.stringify({ event: "persona-applied", elapsedMs: performance.now() - personaStart }));
      expect(personaSubmission.crawl_id).not.toBe(beforePersona.crawl_id);
      expect(personaSubmission.snapshot_id).not.toBe(beforePersona.snapshot_id);
      const priorResponse = await fetch(server + '/api/v1/core/snapshot/' + beforePersona.snapshot_id, { headers: { Authorization: 'Bearer ' + key } });
      if (process.env.AGE_CHECK || process.env.REUSE_LOCAL || oldInterface) { expect(priorResponse.ok).toBe(true); expect(deleteRequests).toHaveLength(0); }
      else if (priorResponse.ok) expect((await priorResponse.json()).status).toBe('deleting');
      else expect(priorResponse.status).toBe(404);
      expect((await entries()).find(e => e.url === url).persona_overrides[serverId]).toBe(testPersona.name);
      expect(await options.evaluate(async serverId => (await chrome.storage.local.get('server_registry')).server_registry.servers.find(s => s.id === serverId).persona, serverId)).toBe(globalPersona);
      const personaCrawls = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      const newCrawl = personaCrawls.find(c => c.id.replaceAll('-', '') === personaSubmission.crawl_id.replaceAll('-', ''));
      expect(newCrawl.config.USER_AGENT).toBe(personaUserAgent);
      expect(newCrawl.config.ONLY_NEW).toBe(false);
      expect(personaCrawls.find(c => c.id.replaceAll('-', '') === beforePersona.crawl_id.replaceAll('-', '')).config.USER_AGENT).not.toBe(personaUserAgent);
      if (process.env.ARCHIVEBOX_TEST_COLLECTION) {
        const query = spawnSync('uv', ['run', '--no-project', 'python', '-c', 'import sqlite3,sys; db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro", uri=True); print(db.execute("SELECT persona_id FROM crawls_crawl WHERE id=?",(sys.argv[2],)).fetchone()[0])', path.join(process.env.ARCHIVEBOX_TEST_COLLECTION, 'index.sqlite3'), personaSubmission.crawl_id.replaceAll('-', '')], { encoding: 'utf8' });
        expect(query.status).toBe(0);
        expect(query.stdout.trim().replaceAll('-', '')).toBe(testPersona.id.replaceAll('-', ''));
      }
      await writeFile(path.join(evidence, 'persona-popup.png'), Buffer.from((await lastPopup.send('Page.captureScreenshot')).data, 'base64'));
      await chooseDepth(1);
      await chooseDepth(2);
      expectedCrawls++;
    }
    if (process.env.RESUBMIT) {
      const previousReceipt = (await entries()).find(e => e.url === url).remote_copies[serverId];
      await lastPopup.click('.archivebox-overlay__resubmit');
      await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.crawl_id).not.toBe(previousReceipt.crawl_id);
      await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status, { timeout: 30000 }).toBe('complete');
      resubmission = (await entries()).find(e => e.url === url).remote_copies[serverId];
      expect(resubmission.snapshot_id).not.toBe(previousReceipt.snapshot_id);
      if (testPersona) expect(resubmission.persona).toBe(testPersona.name);
      await expect.poll(() => lastPopup.evaluate('document.querySelector(".archivebox-overlay__status")?.textContent')).toBe('Submitted');
      await writeFile(path.join(evidence, 'resubmitted-popup.png'), Buffer.from((await lastPopup.send('Page.captureScreenshot')).data, 'base64'));
      const newCrawls = await fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      expect(newCrawls.filter(c => c.urls.split('\n').includes(url))).toHaveLength(expectedCrawls + 1);
      expect(newCrawls.find(c => c.id.replaceAll('-', '') === resubmission.crawl_id.replaceAll('-', '')).config.ONLY_NEW).toBe(false);
      const newRemote = await fetch(server + '/api/v1/core/snapshot/' + resubmission.snapshot_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      expect(newRemote.url).toBe(url);
      expect(newRemote.archiveresults.find(r => r.plugin === 'chrome_extension_viewport')?.status).toBe('succeeded');
      await expect.poll(async () => (await fetch(server + '/api/v1/crawls/crawl/' + resubmission.crawl_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json())).status, { timeout: 60000 }).toBe('sealed');
      const preservedCapture = await fetch(server + '/api/v1/core/snapshot/' + resubmission.snapshot_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      await chooseDepth(1);
      await chooseDepth(2);
      await expect.poll(async () => (await entries()).find(e => e.url === url)?.remote_copies?.[serverId]?.status).toBe('complete');
      const reusedReceipt = (await entries()).find(e => e.url === url).remote_copies[serverId];
      expect(reusedReceipt.snapshot_id).toBe(resubmission.snapshot_id);
      expect(reusedReceipt.snapshot_crawl_id).toBe(resubmission.crawl_id);
      expect(reusedReceipt.crawl_id).not.toBe(reusedReceipt.snapshot_crawl_id);
      const reusedCapture = await fetch(server + '/api/v1/core/snapshot/' + reusedReceipt.snapshot_id, { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      expect(reusedCapture).toEqual(preservedCapture);
      const reusedCrawlSnapshots = await fetch(server + '/api/v1/core/snapshots?url=' + encodeURIComponent(url), { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json());
      expect(reusedCrawlSnapshots.items.filter(item => item.crawl_id === reusedReceipt.crawl_id)).toHaveLength(0);
    }
  }
  if (process.env.RESPONSIVE && lastPopup) {
    // Touch popups use the browser's sheet width; desktop popups request 560px.
    // Chromium's native action target cannot resize, so load the same extension
    // page in a tab for device emulation, using its existing real saved state.
    const responsivePage = await context.newPage();
    const responsiveSession = await context.newCDPSession(responsivePage);
    await responsivePage.goto(`chrome-extension://${id}/popup.html`);
    await expect(responsivePage.locator('.archivebox-overlay__pill-text')).toContainText('Submitted');
    for (const width of [320, 390, 560]) {
      await responsiveSession.send('Emulation.setDeviceMetricsOverride', { width, height: 550, deviceScaleFactor: 2, mobile: true });
      await responsiveSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      const layout = await responsivePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve({
        width: innerWidth, content: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll('.archivebox-overlay__header > div > button')].map(el => ({
          label: el.textContent, scroll: el.scrollWidth, client: el.clientWidth, ...el.getBoundingClientRect().toJSON()
        })),
        rows: [...document.querySelectorAll('.archivebox-overlay__state-row')].map(el => ({
          badgeRight: el.querySelector('.archivebox-overlay__pill').getBoundingClientRect().right,
          actions: [...el.querySelectorAll('.archivebox-overlay__action')].map(button => button.getBoundingClientRect().x)
        }))
      }))));
      expect(layout.width).toBe(width);
      expect(layout.content).toBeLessThanOrEqual(width);
      for (const button of layout.buttons) {
        expect(button.scroll, button.label).toBeLessThanOrEqual(button.client);
        expect(button.right).toBeLessThanOrEqual(width);
        expect(button.top).toBe(layout.buttons[0].top);
      }
      expect(layout.rows[0].actions).toEqual(layout.rows[1].actions);
      for (const row of layout.rows) expect(row.badgeRight).toBeLessThan(row.actions[0]);
      await responsivePage.screenshot({ path: path.join(evidence, `responsive-${width}.png`) });
    }
    await responsivePage.close();
  }
  lastPopup?.close();
  const finalCrawls = () => fetch(server + '/api/v1/crawls/crawls', { headers: { Authorization: 'Bearer ' + key } }).then(r => r.json()).then(items => items.filter(c => c.urls.split('\n').includes(url)));
  if (!oldInterface) await expect.poll(async () => (await finalCrawls()).every(c => c.status === 'sealed'), { timeout: 90000, intervals: [1000] }).toBe(true);
  const sealedCrawls = await finalCrawls();
  const report = { oldInterface, deleteRequests, sealedCrawls, testPersona, personaSubmission, staleDeletionReplacement, lookupRequests, addRequests, resubmission, statusHistory, acceptanceTtfbMs, acceptedMs, elapsedMs: performance.now() - openAt, saved, remote, fullpage: Boolean(process.env.FULLPAGE), fullpageUpload: Boolean(process.env.FULLPAGE_UPLOAD) };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  verified = true;
  console.log(JSON.stringify({ event: 'verified', acceptanceTtfbMs, evidence, plugins: remote.archiveresults.map(r => r.plugin), fullpage: report.fullpage, fullpageUpload: report.fullpageUpload }));
} finally {
  if (verified && process.env.KEEP_OPEN && process.env.ARCHIVEBOX_TEST_PROFILE) {
    chrome.unref();
    console.log(JSON.stringify({ event: 'canary-left-open', profile, evidence }));
    process.exit(process.exitCode || 0);
  }
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    if (browser?.isConnected()) await (await browser.newBrowserCDPSession()).send('Browser.close');
    else chrome.kill('SIGTERM');
    await exited;
  }
  await browser?.close();
  if (!process.env.ARCHIVEBOX_TEST_PROFILE) await rm(profile, { recursive: true, force: true });
}
