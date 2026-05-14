import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import path from 'node:path';

type CdpTarget = {
  targetId: string;
  type: string;
  url: string;
};

type DevToolsTarget = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type DomQuerySelectorAllResult = {
  nodeIds: number[];
};

type DomBoxModelResult = {
  model: {
    border: number[];
    content: number[];
  };
};

type CdpEvent<T = Record<string, unknown>> = {
  method: string;
  params: T;
  sessionId?: string;
};

type CdpClient = {
  send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  waitForEvent<T = Record<string, unknown>>(
    method: string,
    predicate: (event: CdpEvent<T>) => boolean,
    timeoutMs?: number,
  ): Promise<CdpEvent<T>>;
  close(): void;
};

type BrowserHarness = {
  browser: Browser;
  context: BrowserContext;
  cdp: CdpClient;
  extensionId: string;
  process: ChildProcess;
  remoteDebuggingPort: number;
  userDataDir: string;
};

type NativePopup = {
  cdp: CdpClient;
  rootNodeId: number;
  sessionId?: string;
  targetId: string;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FixtureServer = {
  server: Server;
  url: string;
};

const extensionPath = path.resolve('.output/chrome-mv3');
const canaryPath = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const chromeProfilePath = path.resolve('tmp/chrome_profile');
const shortDelay = 250;

function selectedBrowserExecutable(): string {
  if (existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (existsSync(canaryPath)) return canaryPath;
  return chromium.executablePath();
}

function sleep(ms = shortDelay): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json() as T;
    } catch {
      // Browser startup races the first few CDP probes.
    }
    await sleep();
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdpWebSocket(webSocketDebuggerUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Failed to open CDP websocket')), { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, {
    method: string;
    sessionId?: string;
    timeout: ReturnType<typeof setTimeout>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  const eventWaiters = new Set<{
    method: string;
    predicate: (event: CdpEvent) => boolean;
    resolve: (event: CdpEvent) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const recentEvents: string[] = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      if (!message.method) return;
      const cdpEvent = {
        method: message.method,
        params: message.params || {},
        sessionId: message.sessionId,
      };
      recentEvents.push(`${message.method} ${JSON.stringify(message.params || {}).slice(0, 300)}`);
      if (recentEvents.length > 20) recentEvents.shift();
      for (const waiter of [...eventWaiters]) {
        if (waiter.method !== message.method || !waiter.predicate(cdpEvent)) continue;
        clearTimeout(waiter.timeout);
        eventWaiters.delete(waiter);
        waiter.resolve(cdpEvent);
      }
      return;
    }
    if (!pending.has(message.id)) return;
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (!callbacks) return;
    clearTimeout(callbacks.timeout);
    if (message.error) {
      callbacks.reject(new Error(`${callbacks.method}${callbacks.sessionId ? ` [${callbacks.sessionId}]` : ''}: ${message.error.message}: ${message.error.data || ''}`.trim()));
      return;
    }
    callbacks.resolve(message.result || {});
  });

  return {
    send<T = Record<string, unknown>>(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) {
      return new Promise<T>((resolve, reject) => {
        const id = nextId += 1;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}${sessionId ? ` [${sessionId}]` : ''}: timed out waiting for CDP response. Recent events: ${recentEvents.join(' | ')}`));
        }, 15_000);
        pending.set(id, {
          method,
          sessionId,
          timeout,
          resolve: (value) => resolve(value as T),
          reject,
        });
        socket.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }));
      });
    },
    waitForEvent<T = Record<string, unknown>>(
      method: string,
      predicate: (event: CdpEvent<T>) => boolean,
      timeoutMs = 10_000,
    ) {
      return new Promise<CdpEvent<T>>((resolve, reject) => {
        const waiter = {
          method,
          predicate: predicate as (event: CdpEvent) => boolean,
          resolve: resolve as (event: CdpEvent) => void,
          reject,
          timeout: setTimeout(() => {
            eventWaiters.delete(waiter);
            reject(new Error(`Timed out waiting for CDP event ${method}. Recent events: ${recentEvents.join(' | ')}`));
          }, timeoutMs),
        };
        eventWaiters.add(waiter);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function connectBrowserCdp(port: number): Promise<CdpClient> {
  const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${port}/json/version`);
  return connectCdpWebSocket(version.webSocketDebuggerUrl);
}

async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>ArchiveBox Playwright Fixture</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 24px; }
            main { min-height: 17280px; max-width: 760px; }
            section { margin-top: 16880px; padding: 24px; border: 1px solid #ccd; }
          </style>
        </head>
        <body>
          <main>
            <h1>ArchiveBox Playwright Fixture</h1>
            <p id="fixture-marker">archivebox-popup-integration-fixture</p>
            <section id="bottom-marker">
              Bottom page content after 17,000px for full-page screenshot capture.
            </section>
          </main>
        </body>
      </html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to a TCP port');
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function launchHarness(): Promise<BrowserHarness> {
  if (!existsSync(extensionPath)) {
    throw new Error(`Missing built extension at ${extensionPath}. Run pnpm build before pnpm test.`);
  }

  const executablePath = selectedBrowserExecutable();
  const remoteDebuggingPort = await freePort();
  await rm(chromeProfilePath, { recursive: true, force: true });
  await mkdir(chromeProfilePath, { recursive: true });
  const userDataDir = chromeProfilePath;
  const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank',
  ];
  if (headlessLinux) {
    args.splice(args.length - 1, 0, '--headless=new', '--no-sandbox');
  }

  const browserProcess = spawn(executablePath, args, { stdio: 'ignore' });
  await waitForJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
  const cdp = await connectBrowserCdp(remoteDebuggingPort);
  const loaded = await cdp.send<{ id: string }>('Extensions.loadUnpacked', { path: extensionPath });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Playwright did not expose the CDP browser context');

  return {
    browser,
    context,
    cdp,
    extensionId: loaded.id,
    process: browserProcess,
    remoteDebuggingPort,
    userDataDir,
  };
}

async function closeHarness(harness: BrowserHarness): Promise<void> {
  await harness.browser.close().catch(() => undefined);
  harness.cdp.close();
  if (!harness.process.killed) {
    harness.process.kill('SIGTERM');
  }
  await sleep();
}

async function extensionStoragePage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function setExtensionStorage(context: BrowserContext, extensionId: string, values: Record<string, unknown>): Promise<void> {
  const page = await extensionStoragePage(context, extensionId);
  await page.evaluate(async (storageValues) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    await new Promise<void>((resolve, reject) => {
      extensionApi.storage.local.set(storageValues, () => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }, values);
  await page.close();
}

async function getExtensionStorage<T>(context: BrowserContext, extensionId: string, key: string): Promise<T | undefined> {
  const page = await extensionStoragePage(context, extensionId);
  const value = await page.evaluate(async (storageKey) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return await new Promise<unknown>((resolve, reject) => {
      extensionApi.storage.local.get(storageKey, (items: Record<string, unknown>) => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(items[storageKey]);
      });
    });
  }, key);
  await page.close();
  return value as T | undefined;
}

async function extensionHasPermission(context: BrowserContext, extensionId: string, permission: string): Promise<boolean> {
  const page = await extensionStoragePage(context, extensionId);
  const granted = await page.evaluate(async (permissionName) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return await new Promise<boolean>((resolve) => {
      extensionApi.permissions.contains({ permissions: [permissionName as Browser.runtime.ManifestPermission] }, resolve);
    });
  }, permission);
  await page.close();
  return granted;
}

async function waitForTabTarget(cdp: CdpClient, url: string): Promise<CdpTarget> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { targetInfos } = await cdp.send<{ targetInfos: CdpTarget[] }>('Target.getTargets', { filter: [{}] });
    const target = targetInfos.find((item) => item.type === 'tab' && item.url === url)
      || targetInfos.find((item) => item.type === 'tab' && item.url.startsWith(url));
    if (target) return target;
    await sleep();
  }
  throw new Error(`Timed out waiting for tab target: ${url}`);
}

async function extensionPopupTargets(harness: BrowserHarness): Promise<CdpTarget[]> {
  const { targetInfos } = await harness.cdp.send<{ targetInfos: CdpTarget[] }>('Target.getTargets', { filter: [{}] });
  const popupUrl = `chrome-extension://${harness.extensionId}/popup.html`;
  return targetInfos.filter((item) => item.type === 'page' && item.url.startsWith(popupUrl));
}

async function waitForNoNativePopup(harness: BrowserHarness): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await extensionPopupTargets(harness)).length === 0) return;
    await sleep();
  }
  throw new Error('Timed out waiting for native popup to close');
}

async function closeExistingNativePopups(harness: BrowserHarness): Promise<void> {
  const targets = await extensionPopupTargets(harness);
  await Promise.all(targets.map((target) => (
    harness.cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => undefined)
  )));
  if (targets.length > 0) await waitForNoNativePopup(harness);
}

async function waitForPopupDevToolsTarget(harness: BrowserHarness): Promise<DevToolsTarget> {
  const popupUrl = `chrome-extension://${harness.extensionId}/popup.html`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await waitForJson<DevToolsTarget[]>(`http://127.0.0.1:${harness.remoteDebuggingPort}/json/list`);
    const target = targets.find((item) => item.url.startsWith(popupUrl) && item.webSocketDebuggerUrl);
    if (target) return target;
    await sleep();
  }
  throw new Error('Timed out waiting for popup DevTools websocket target');
}

async function openNativePopup(harness: BrowserHarness, page: Page): Promise<NativePopup> {
  await closeExistingNativePopups(harness);
  await page.bringToFront();
  const tabTarget = await waitForTabTarget(harness.cdp, page.url());
  await harness.cdp.send('Extensions.triggerAction', {
    id: harness.extensionId,
    targetId: tabTarget.targetId,
  });

  await sleep(1500);
  const target = await waitForPopupDevToolsTarget(harness);
  if (!target.webSocketDebuggerUrl) throw new Error('Popup target does not expose a DevTools websocket');
  const popupCdp = await connectCdpWebSocket(target.webSocketDebuggerUrl);
  await popupCdp.send('DOM.enable');
  const { root } = await popupCdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  const rootNodeId = root.nodeId;
  const popup = { cdp: popupCdp, rootNodeId, targetId: target.id };
  await waitForPopupDom(harness, popup, 'native popup React root', '.archivebox-overlay');
  return popup;
}

async function popupRootNodeId(popup: NativePopup): Promise<number> {
  return popup.rootNodeId;
}

async function refreshPopupRootNodeId(popup: NativePopup): Promise<number> {
  const { root } = await popup.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 }, popup.sessionId);
  popup.rootNodeId = root.nodeId;
  return root.nodeId;
}

async function popupHtml(_harness: BrowserHarness, popup: NativePopup): Promise<string> {
  const rootNodeId = await popupRootNodeId(popup);
  try {
    const { outerHTML } = await popup.cdp.send<{ outerHTML: string }>('DOM.getOuterHTML', { nodeId: rootNodeId }, popup.sessionId);
    return outerHTML;
  } catch {
    const refreshedRootNodeId = await refreshPopupRootNodeId(popup);
    const { outerHTML } = await popup.cdp.send<{ outerHTML: string }>('DOM.getOuterHTML', { nodeId: refreshedRootNodeId }, popup.sessionId);
    return outerHTML;
  }
}

function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function popupNodeIds(popup: NativePopup, selector: string): Promise<number[]> {
  const rootNodeId = await popupRootNodeId(popup);
  try {
    const { nodeIds } = await popup.cdp.send<DomQuerySelectorAllResult>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector,
    }, popup.sessionId);
    return nodeIds;
  } catch {
    const refreshedRootNodeId = await refreshPopupRootNodeId(popup);
    const { nodeIds } = await popup.cdp.send<DomQuerySelectorAllResult>('DOM.querySelectorAll', {
      nodeId: refreshedRootNodeId,
      selector,
    }, popup.sessionId);
    return nodeIds;
  }
}

async function popupNodeHtml(popup: NativePopup, nodeId: number): Promise<string> {
  const { outerHTML } = await popup.cdp.send<{ outerHTML: string }>('DOM.getOuterHTML', { nodeId }, popup.sessionId);
  return outerHTML;
}

async function popupElementsHtml(popup: NativePopup, selector: string): Promise<string[]> {
  const nodeIds = await popupNodeIds(popup, selector);
  return Promise.all(nodeIds.map((nodeId) => popupNodeHtml(popup, nodeId)));
}

async function findPopupNodeByText(popup: NativePopup, selector: string, text: string | RegExp): Promise<number> {
  const nodeIds = await popupNodeIds(popup, selector);
  for (const nodeId of nodeIds) {
    const nodeText = htmlText(await popupNodeHtml(popup, nodeId));
    if (typeof text === 'string' ? nodeText === text : text.test(nodeText)) return nodeId;
  }
  throw new Error(`Popup element not found for ${selector} with text ${String(text)}`);
}

async function waitForPopupDom(
  harness: BrowserHarness,
  popup: NativePopup,
  description: string,
  selector: string,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rootNodeId = await popupRootNodeId(popup);
    const { nodeId } = await popup.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: rootNodeId, selector }, popup.sessionId);
    if (nodeId) return;
    await sleep();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForPopupHtmlCondition(
  harness: BrowserHarness,
  popup: NativePopup,
  description: string,
  predicate: (html: string) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate(await popupHtml(harness, popup))) return;
    await sleep();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForPopupElementsCondition(
  harness: BrowserHarness,
  popup: NativePopup,
  description: string,
  selector: string,
  predicate: (htmlItems: string[]) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate(await popupElementsHtml(popup, selector))) return;
    await sleep();
  }
  throw new Error(`Timed out waiting for ${description}. Popup text: ${htmlText(await popupHtml(harness, popup))}`);
}

async function waitForPopupText(
  harness: BrowserHarness,
  popup: NativePopup,
  text: string | RegExp,
  timeoutMs = 10_000,
): Promise<void> {
  await waitForPopupHtmlCondition(
    harness,
    popup,
    `popup text ${String(text)}`,
    (html) => {
      const textContent = htmlText(html);
      return typeof text === 'string' ? textContent.includes(text) : text.test(textContent);
    },
    timeoutMs,
  );
}

async function popupElementRect(_harness: BrowserHarness, popup: NativePopup, nodeId: number): Promise<Rect> {
  const { model } = await popup.cdp.send<DomBoxModelResult>('DOM.getBoxModel', { nodeId }, popup.sessionId);
  const points = model.border.length ? model.border : model.content;
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function clickPopupRect(harness: BrowserHarness, popup: NativePopup, rect: Rect): Promise<void> {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await popup.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, popup.sessionId);
  await popup.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, popup.sessionId);
  await popup.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, popup.sessionId);
}

async function clickPopupNode(harness: BrowserHarness, popup: NativePopup, nodeId: number): Promise<void> {
  await clickPopupRect(harness, popup, await popupElementRect(harness, popup, nodeId));
}

async function clickPopupTitle(harness: BrowserHarness, popup: NativePopup, title: string): Promise<void> {
  const [nodeId] = await popupNodeIds(popup, `[title="${cssAttributeValue(title)}"]`);
  if (!nodeId) throw new Error(`Popup title not found: ${title}`);
  await clickPopupNode(harness, popup, nodeId);
}

async function clickPopupButtonText(harness: BrowserHarness, popup: NativePopup, text: string | RegExp): Promise<void> {
  await clickPopupNode(harness, popup, await findPopupNodeByText(popup, 'button', text));
}

async function focusTagInput(harness: BrowserHarness, popup: NativePopup): Promise<void> {
  const [nodeId] = await popupNodeIds(popup, 'input[placeholder="+ tag"]');
  if (!nodeId) throw new Error('Tag input not found');
  await clickPopupNode(harness, popup, nodeId);
}

async function pressPopupKey(harness: BrowserHarness, popup: NativePopup, key: string): Promise<void> {
  const keyCode = key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0;
  const code = key === 'Enter' ? 'Enter' : key === 'Escape' ? 'Escape' : key;
  await popup.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, popup.sessionId);
  await popup.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, popup.sessionId);
}

async function typeTag(harness: BrowserHarness, popup: NativePopup, tag: string): Promise<void> {
  await focusTagInput(harness, popup);
  await popup.cdp.send('Input.insertText', { text: tag }, popup.sessionId);
  await pressPopupKey(harness, popup, 'Enter');
}

async function acceptPossiblePermissionPrompt(page: Page): Promise<void> {
  await page.keyboard.press('Enter').catch(() => undefined);
  await sleep(500);
}

async function acceptPossiblePermissionPrompts(page: Page, count = 3): Promise<void> {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await acceptPossiblePermissionPrompt(page);
  }
}

async function acceptPermissionPromptByKeyboard(page: Page, count = 3): Promise<void> {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await page.keyboard.press('Enter').catch(() => undefined);
    await sleep(200);
    await page.keyboard.press('Tab').catch(() => undefined);
    await sleep(100);
    await page.keyboard.press('Enter').catch(() => undefined);
    await sleep(500);
  }
}

async function grantExtensionPermissionViaCdp(harness: BrowserHarness, permission: string): Promise<void> {
  const origin = `chrome-extension://${harness.extensionId}`;
  await harness.cdp.send('Browser.setPermission', {
    permission: { name: permission },
    setting: 'granted',
    origin,
  }).catch(() => undefined);
  await harness.cdp.send('Browser.grantPermissions', {
    permissions: [permission],
    origin,
  }).catch(() => undefined);
}

async function savedEntries(context: BrowserContext, extensionId: string): Promise<Array<Record<string, unknown>>> {
  return (await getExtensionStorage<Array<Record<string, unknown>>>(context, extensionId, 'entries')) || [];
}

async function waitForSavedEntry(
  context: BrowserContext,
  extensionId: string,
  url: string,
  predicate: (entry: Record<string, unknown>) => boolean,
  description: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = (await savedEntries(context, extensionId)).find((item) => item.url === url);
    if (entry && predicate(entry)) return entry;
    await sleep();
  }
  throw new Error(`Timed out waiting for saved entry ${description}`);
}

test('native action popup supports local save, tags, depth, captures, navigation, and dismissal', async () => {
  const server = await startFixtureServer();
  const harness = await launchHarness();

  try {
    await setExtensionStorage(harness.context, harness.extensionId, {
      entries: [{
        id: 'seed-entry',
        url: 'https://seed.archivebox.test/',
        timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        tags: ['existing', 'research'],
        title: 'Seed entry',
        favIconUrl: null,
        depth: 0,
      }],
      archivebox_server_url: '',
      archivebox_api_key: '',
    });

    const page = await harness.context.newPage();
    const testPageUrl = `${server.url}?archivebox_test=1`;
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    expect(await extensionHasPermission(harness.context, harness.extensionId, 'scripting')).toBe(false);
    expect(await extensionHasPermission(harness.context, harness.extensionId, 'pageCapture')).toBe(false);

    let popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, 'ArchiveBox Playwright Fixture');
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    await waitForPopupText(harness, popup, 'Server not connected');

    await clickPopupButtonText(harness, popup, /^existing\s*\+$/);
    await waitForPopupElementsCondition(
      harness,
      popup,
      'added suggested tag',
      '.archivebox-tag-chip--current',
      (htmlItems) => htmlItems.some((html) => htmlText(html).includes('existing')),
    );

    await clickPopupTitle(harness, popup, 'Remove tag existing');
    await waitForPopupElementsCondition(
      harness,
      popup,
      'removed existing tag',
      '.archivebox-tag-chip--current',
      (htmlItems) => !htmlItems.some((html) => htmlText(html).includes('existing')),
    );

    await typeTag(harness, popup, 'typedtag');
    await waitForPopupElementsCondition(
      harness,
      popup,
      'typed tag',
      '.archivebox-tag-chip--current',
      (htmlItems) => htmlItems.some((html) => htmlText(html).includes('typedtag')),
    );

    await clickPopupButtonText(harness, popup, 'Crawl');
    await clickPopupButtonText(harness, popup, /^Depth 2:/);
    await waitForPopupText(harness, popup, 'Crawl Depth: 2');

    const mhtmlButtonRect = await popupElementRect(harness, popup, await findPopupNodeByText(popup, 'button', 'MHTML'));
    await clickPopupButtonText(harness, popup, 'Screenshot');
    await acceptPossiblePermissionPrompts(page, 6);
    await waitForSavedEntry(
      harness.context,
      harness.extensionId,
      testPageUrl,
      (entry) => Boolean(entry.screenshot),
      'screenshot',
      180_000,
    );

    await clickPopupRect(harness, popup, mhtmlButtonRect);
    await sleep(500);
    await acceptPermissionPromptByKeyboard(page, 6);
    if (!(await extensionHasPermission(harness.context, harness.extensionId, 'pageCapture'))) {
      await grantExtensionPermissionViaCdp(harness, 'pageCapture');
    }
    if (await extensionHasPermission(harness.context, harness.extensionId, 'pageCapture')) {
      await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }).catch(() => undefined);
      popup.cdp.close();
      await waitForNoNativePopup(harness);
      popup = await openNativePopup(harness, page);
      await clickPopupButtonText(harness, popup, 'MHTML');
    }
    await waitForSavedEntry(
      harness.context,
      harness.extensionId,
      testPageUrl,
      (entry) => Boolean(entry.mhtml),
      'MHTML',
      30_000,
    );

    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }).catch(() => undefined);
    popup.cdp.close();
    await waitForNoNativePopup(harness);
    expect(await extensionHasPermission(harness.context, harness.extensionId, 'scripting')).toBe(true);
    expect(await extensionHasPermission(harness.context, harness.extensionId, 'pageCapture')).toBe(true);

    let entries = await savedEntries(harness.context, harness.extensionId);
    const snapshot = entries.find((entry) => entry.url === testPageUrl);
    expect(snapshot?.tags).toContain('typedtag');
    expect(snapshot?.depth).toBe(2);
    expect(snapshot?.screenshot).toBeTruthy();
    expect(snapshot?.mhtml).toBeTruthy();
    const snapshotId = String(snapshot?.id || '');
    expect(snapshotId).toBeTruthy();

    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    popup = await openNativePopup(harness, page);
    await pressPopupKey(harness, popup, 'Escape');
    await waitForNoNativePopup(harness);
    entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    popup = await openNativePopup(harness, page);
    const optionsFromGear = harness.context.waitForEvent('page');
    await clickPopupTitle(harness, popup, 'Open options');
    const gearPage = await optionsFromGear;
    await gearPage.waitForLoadState('domcontentloaded');
    await expect(gearPage).toHaveURL(/chrome-extension:\/\/[^/]+\/options\.html/);
    await gearPage.close();
    await waitForNoNativePopup(harness);

    popup = await openNativePopup(harness, page);
    const optionsFromLocalView = harness.context.waitForEvent('page');
    await clickPopupTitle(harness, popup, 'Show in Saved URLs');
    const localViewPage = await optionsFromLocalView;
    await localViewPage.waitForLoadState('domcontentloaded');
    expect(localViewPage.url()).toContain(`highlight=${encodeURIComponent(snapshotId)}`);
    await localViewPage.close();
    await waitForNoNativePopup(harness);

    popup = await openNativePopup(harness, page);
    await clickPopupTitle(harness, popup, 'Remove from local saved URLs');
    await waitForNoNativePopup(harness);
    entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(false);
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});
