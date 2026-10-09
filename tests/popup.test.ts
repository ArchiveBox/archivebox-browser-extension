import { test } from './helpers/archivebox';
import type { Snapshot } from '../src/lib/types';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';

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
  on<T = Record<string, unknown>>(method: string, handler: (event: CdpEvent<T>) => void): () => void;
  close(): void;
};

type BrowserHarness = {
  browser: Browser;
  context: BrowserContext;
  cdp: CdpClient;
  extensionPath: string;
  extensionId: string;
  process: ChildProcess;
  remoteDebuggingPort: number;
  storagePage: Page;
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

const server_id = '00000000-0000-4000-8000-000000000001';
function serverSettings(server: string, token = '') {
  return {
    server_registry: {
      schema_version: 1,
      servers: server ? [{ id: server_id, name: 'Test', server, token, persona: null }] : [],
      active_server_id: server ? server_id : null,
      default_server_ids: server ? [server_id] : [],
    },
    server_policies: { [server_id]: { upload_screenshots_to_server: true, upload_mhtml_to_server: true, upload_singlefile_to_server: true } },
  };
}

const builtExtensionPath = path.resolve('.output/chrome-mv3');
const testExtensionBasePath = path.join(tmpdir(), 'archivebox-popup-test-extensions');
const canaryPath = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const chromeProfileBasePath = path.join(tmpdir(), 'archivebox-popup-test-profiles');
const shortDelay = 50;

function selectedBrowserExecutable(): string {
  const override = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN;
  if (override && existsSync(override)) return override;
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

async function waitForJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
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
  const eventListeners = new Map<string, Set<(event: CdpEvent) => void>>();

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
      for (const handler of eventListeners.get(message.method) || []) {
        handler(cdpEvent);
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
    on<T = Record<string, unknown>>(method: string, handler: (event: CdpEvent<T>) => void) {
      const listeners = eventListeners.get(method) || new Set<(event: CdpEvent) => void>();
      listeners.add(handler as (event: CdpEvent) => void);
      eventListeners.set(method, listeners);
      return () => {
        eventListeners.get(method)?.delete(handler as (event: CdpEvent) => void);
      };
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

async function prepareTestExtensionPath(extensionPath: string): Promise<string> {
  if (!existsSync(builtExtensionPath)) {
    throw new Error(`Missing built extension at ${builtExtensionPath}. Run pnpm build before pnpm test.`);
  }

  await mkdir(path.dirname(extensionPath), { recursive: true });
  await rm(extensionPath, { recursive: true, force: true });
  await cp(builtExtensionPath, extensionPath, { recursive: true });

  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    host_permissions?: string[];
    permissions?: string[];
    optional_host_permissions?: string[];
    optional_permissions?: string[];
  };
  const permissions = new Set(manifest.permissions || []);
  const hostPermissions = new Set(manifest.host_permissions || []);
  const optionalHostPermissions = new Set(manifest.optional_host_permissions || []);
  const optionalPermissions = new Set(manifest.optional_permissions || []);
  // Chrome's pageCapture permission prompt is browser UI and is not exposed
  // through Playwright/CDP, so the live MHTML assertion uses a test copy with
  // that Chrome-only permission pregranted.
  if (optionalPermissions.delete('pageCapture')) {
    permissions.add('pageCapture');
  }
  // The deterministic CDP popup target used by this test does not receive
  // Chrome's transient activeTab grant, so pregrant tabs in the test copy.
  if (optionalPermissions.delete('tabs')) {
    permissions.add('tabs');
  }
  if (optionalPermissions.delete('scripting')) {
    permissions.add('scripting');
  }
  if (optionalHostPermissions.delete('<all_urls>')) {
    hostPermissions.add('<all_urls>');
  }
  manifest.permissions = [...permissions];
  manifest.host_permissions = [...hostPermissions];
  manifest.optional_host_permissions = [...optionalHostPermissions];
  manifest.optional_permissions = [...optionalPermissions];
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  return extensionPath;
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
            main { min-height: 520px; max-width: 760px; }
            section { margin-top: 120px; padding: 24px; border: 1px solid #ccd; }
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

function spawnBrowser(
  executablePath: string,
  userDataDir: string,
  remoteDebuggingPort: number,
  extraArgs: string[],
): ChildProcess {
  const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    // Chrome 149+ exposes the CDP Extensions domain (Extensions.loadUnpacked)
    // only when extension debugging is explicitly enabled over the connection.
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    ...extraArgs,
    'about:blank',
  ];
  if (headlessLinux) {
    args.splice(args.length - 1, 0, '--headless=new', '--no-sandbox');
  }
  return spawn(executablePath, args, { stdio: 'ignore' });
}

async function launchHarness(): Promise<BrowserHarness> {
  const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const extensionPath = await prepareTestExtensionPath(path.join(testExtensionBasePath, runId));
  const executablePath = selectedBrowserExecutable();
  const remoteDebuggingPort = await freePort();
  const userDataDir = path.join(chromeProfileBasePath, runId);
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  const browserProcess = spawnBrowser(executablePath, userDataDir, remoteDebuggingPort, []);
  await waitForJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
  const cdp = await connectBrowserCdp(remoteDebuggingPort);
  const { id: extensionId } = await cdp.send<{ id: string }>('Extensions.loadUnpacked', { path: extensionPath });

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Playwright did not expose the CDP browser context');
  const storagePage = await context.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });

  return {
    browser,
    context,
    cdp,
    extensionPath,
    extensionId,
    process: browserProcess,
    remoteDebuggingPort,
    storagePage,
    userDataDir,
  };
}

async function waitForProcessExit(process: ChildProcess, timeoutMs = 2_000): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function closeHarness(harness: BrowserHarness): Promise<void> {
  await harness.storagePage.close().catch(() => undefined);
  await harness.browser.close().catch(() => undefined);
  harness.cdp.close();
  if (!harness.process.killed) {
    harness.process.kill('SIGTERM');
  }
  await waitForProcessExit(harness.process);
  await rm(harness.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(harness.extensionPath, { recursive: true, force: true }).catch(() => undefined);
}

async function setExtensionStorage(harness: BrowserHarness, values: Record<string, unknown>): Promise<void> {
  await harness.storagePage.evaluate(async (storageValues) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    await new Promise<void>((resolve, reject) => {
      extensionApi.storage.local.set(storageValues, () => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }, values);
}

async function getExtensionStorage<T>(harness: BrowserHarness, key: string): Promise<T | undefined> {
  const value = await harness.storagePage.evaluate(async (storageKey) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return await new Promise<unknown>((resolve, reject) => {
      extensionApi.storage.local.get(storageKey, (items: Record<string, unknown>) => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(items[storageKey]);
      });
    });
  }, key);
  return value as T | undefined;
}

async function sendExtensionMessage<T>(harness: BrowserHarness, message: Record<string, unknown>): Promise<T> {
  const response = await harness.storagePage.evaluate(async (runtimeMessage) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return await new Promise<unknown>((resolve, reject) => {
      extensionApi.runtime.sendMessage(runtimeMessage, (result) => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    });
  }, message);
  return response as T;
}

async function extensionHasPermission(harness: BrowserHarness, permission: string): Promise<boolean> {
  return await harness.storagePage.evaluate(async (permissionName) => {
    const extensionApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return await new Promise<boolean>((resolve) => {
      extensionApi.permissions.contains({ permissions: [permissionName as Browser.runtime.ManifestPermission] }, resolve);
    });
  }, permission);
}

type ConsoleMessage = {
  source: string;
  type: string;
  text: string;
};

type ConsoleCollector = {
  messages: ConsoleMessage[];
  errors: () => ConsoleMessage[];
  close: () => void;
};

function remoteObjectText(arg: { value?: unknown; description?: string; unserializableValue?: string }): string {
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  if (arg.description) return arg.description;
  if (arg.unserializableValue) return arg.unserializableValue;
  return '';
}

async function attachConsoleCollector(cdp: CdpClient, source: string, messages: ConsoleMessage[]): Promise<void> {
  cdp.on<{ type: string; args?: Array<{ value?: unknown; description?: string }> }>('Runtime.consoleAPICalled', (event) => {
    const text = (event.params.args || []).map(remoteObjectText).join(' ');
    messages.push({ source, type: event.params.type, text });
  });
  cdp.on<{ exceptionDetails?: { text?: string; exception?: { description?: string } } }>('Runtime.exceptionThrown', (event) => {
    const details = event.params.exceptionDetails;
    messages.push({
      source,
      type: 'error',
      text: details?.exception?.description || details?.text || 'Uncaught exception',
    });
  });
  cdp.on<{ entry: { level: string; text: string } }>('Log.entryAdded', (event) => {
    messages.push({ source, type: event.params.entry.level, text: event.params.entry.text });
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
}

async function findDevToolsTarget(
  harness: BrowserHarness,
  predicate: (target: DevToolsTarget) => boolean,
  timeoutMs = 15_000,
): Promise<DevToolsTarget> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targets = await waitForJson<DevToolsTarget[]>(`http://127.0.0.1:${harness.remoteDebuggingPort}/json/list`);
    const target = targets.find((item) => predicate(item) && item.webSocketDebuggerUrl);
    if (target) return target;
    await sleep();
  }
  throw new Error('Timed out waiting for DevTools target');
}

async function collectBackgroundConsole(harness: BrowserHarness, messages: ConsoleMessage[]): Promise<ConsoleCollector> {
  const target = await findDevToolsTarget(harness, (item) => (
    item.type === 'service_worker' && item.url === `chrome-extension://${harness.extensionId}/background.js`
  ));
  const cdp = await connectCdpWebSocket(target.webSocketDebuggerUrl as string);
  await attachConsoleCollector(cdp, 'background', messages);
  return {
    messages,
    errors: () => messages.filter((message) => message.type === 'error'),
    close: () => cdp.close(),
  };
}

async function pageTargetExists(harness: BrowserHarness, url: string): Promise<boolean> {
  const { targetInfos } = await harness.cdp.send<{ targetInfos: CdpTarget[] }>('Target.getTargets', { filter: [{}] });
  return targetInfos.some((target) => (
    (target.type === 'page' || target.type === 'tab') && target.url.startsWith(url)
  ));
}

// Console errors/warnings that ArchiveBox itself produced, ignoring noise the
// fixture page generates on its own (e.g. its missing /favicon.ico).
function archiveboxConsoleProblems(messages: ConsoleMessage[]): ConsoleMessage[] {
  return messages.filter((message) => {
    if (message.type !== 'error' && message.type !== 'warning') return false;
    if (message.source === 'page' && /Failed to load resource/i.test(message.text)) return false;
    if (
      message.source === 'popup'
      && (
        /cross-world extension resource mismatch/i.test(message.text)
        || /was preloaded using link preload but not used/i.test(message.text)
      )
    ) return false;
    return true;
  });
}

function consoleMessagesMatching(messages: ConsoleMessage[], pattern: RegExp): ConsoleMessage[] {
  return messages.filter((message) => pattern.test(message.text));
}

async function waitForConsoleMessage(messages: ConsoleMessage[], pattern: RegExp, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (consoleMessagesMatching(messages, pattern).length > 0) return;
    await sleep();
  }
  throw new Error(`Timed out waiting for console message matching ${pattern}`);
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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await extensionPopupTargets(harness)).length === 0) return;
    await sleep();
  }
  const targets = await extensionPopupTargets(harness);
  await Promise.all(targets.map((target) => (
    harness.cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => undefined)
  )));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await extensionPopupTargets(harness)).length === 0) return;
    await sleep();
  }
  throw new Error('Timed out waiting for popup target cleanup');
}

async function closeExistingNativePopups(harness: BrowserHarness): Promise<void> {
  const targets = await extensionPopupTargets(harness);
  await Promise.all(targets.map((target) => (
    harness.cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => undefined)
  )));
  if (targets.length > 0) await waitForNoNativePopup(harness);
}

async function waitForPopupDevToolsTarget(harness: BrowserHarness, targetId?: string): Promise<DevToolsTarget> {
  const popupUrl = `chrome-extension://${harness.extensionId}/popup.html`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await waitForJson<DevToolsTarget[]>(`http://127.0.0.1:${harness.remoteDebuggingPort}/json/list`);
    const target = targets.find((item) => (
      (targetId ? item.id === targetId : item.url.startsWith(popupUrl))
      && item.webSocketDebuggerUrl
    ));
    if (target) return target;
    await sleep();
  }
  throw new Error('Timed out waiting for popup DevTools websocket target');
}

async function openNativePopup(harness: BrowserHarness, page: Page): Promise<NativePopup> {
  await closeExistingNativePopups(harness);
  await page.bringToFront();
  const popupUrl = `chrome-extension://${harness.extensionId}/popup.html`;
  const { targetId } = await harness.cdp.send<{ targetId: string }>('Target.createTarget', {
    url: popupUrl,
    background: true,
  });
  await page.bringToFront();

  const target = await waitForPopupDevToolsTarget(harness, targetId);
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
  try {
    const nodeIds = await popupNodeIds(popup, selector);
    return await Promise.all(nodeIds.map((nodeId) => popupNodeHtml(popup, nodeId)));
  } catch {
    const refreshedRootNodeId = await refreshPopupRootNodeId(popup);
    const { nodeIds } = await popup.cdp.send<DomQuerySelectorAllResult>('DOM.querySelectorAll', {
      nodeId: refreshedRootNodeId,
      selector,
    }, popup.sessionId);
    return await Promise.all(nodeIds.map((nodeId) => popupNodeHtml(popup, nodeId)));
  }
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
    try {
      const rootNodeId = await refreshPopupRootNodeId(popup);
      const { nodeId } = await popup.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: rootNodeId, selector }, popup.sessionId);
      if (nodeId) return;
    } catch {
      await refreshPopupRootNodeId(popup).catch(() => undefined);
    }
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

async function clickPopupSelector(harness: BrowserHarness, popup: NativePopup, selector: string): Promise<void> {
  const [nodeId] = await popupNodeIds(popup, selector);
  if (!nodeId) throw new Error(`Popup selector not found: ${selector}`);
  await clickPopupNode(harness, popup, nodeId);
}

async function clickPopupTitle(harness: BrowserHarness, popup: NativePopup, title: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await popup.cdp.send<{ result?: { value?: boolean } }>('Runtime.evaluate', {
      expression: `
        (() => {
          const element = document.querySelector('[title="${cssAttributeValue(title)}"]');
          if (!(element instanceof HTMLElement)) return false;
          if ('disabled' in element && element.disabled) return false;
          element.click();
          return true;
        })()
      `,
    }, popup.sessionId);
    if (response.result?.value) return;
    await sleep();
  }
  throw new Error(`Popup title not found: ${title}. Popup text: ${htmlText(await popupHtml(harness, popup))}`);
}

async function clickPopupButtonText(harness: BrowserHarness, popup: NativePopup, text: string | RegExp): Promise<void> {
  const pattern = typeof text === 'string'
    ? { kind: 'string', value: text }
    : { kind: 'regexp', source: text.source, flags: text.flags };
  const response = await popup.cdp.send<{ result?: { value?: boolean } }>('Runtime.evaluate', {
    expression: `
      (() => {
        const pattern = ${JSON.stringify(pattern)};
        const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
        for (const element of document.querySelectorAll('button')) {
          const text = normalize(element.getAttribute('aria-label') || element.innerText || '');
          const matches = pattern.kind === 'string'
            ? text === pattern.value
            : new RegExp(pattern.source, pattern.flags).test(text);
          if (matches) {
            if (element.disabled) return false;
            element.click();
            return true;
          }
        }
        return false;
      })()
    `,
  }, popup.sessionId);
  if (!response.result?.value) throw new Error(`Popup button not found: ${String(text)}`);
}

async function typeTag(harness: BrowserHarness, popup: NativePopup, tag: string): Promise<void> {
  const response = await popup.cdp.send<{ result?: { value?: boolean } }>('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('input[placeholder="+ tag"]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, ${JSON.stringify(tag)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        input.blur();
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        return input.value === ${JSON.stringify(tag)};
      })()
    `,
  }, popup.sessionId);
  if (!response.result?.value) throw new Error('Failed to set popup tag input value');
}

async function savedEntries(harness: BrowserHarness): Promise<Array<Record<string, unknown>>> {
  return (await getExtensionStorage<Array<Record<string, unknown>>>(harness, 'entries')) || [];
}

async function waitForSavedEntry(
  harness: BrowserHarness,
  url: string,
  predicate: (entry: Record<string, unknown>) => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = (await savedEntries(harness)).find((item) => item.url === url);
    if (entry && predicate(entry)) return entry;
    await sleep();
  }
  throw new Error(`Timed out waiting for saved entry ${description}`);
}

async function waitForNoSavedEntry(harness: BrowserHarness, url: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await savedEntries(harness)).some((entry) => entry.url === url)) return;
    await sleep();
  }
  throw new Error(`Timed out waiting for saved entry removal: ${url}`);
}

test('the injected page content script contains no popup or window-closing code', async () => {
  // The overlay/popup UI (which legitimately calls window.close() on its own
  // popup window) must never be bundled into the content script that gets
  // injected into the pages the user is viewing -- otherwise window.close()
  // would run in the page context and close the user's tab. This guards against
  // a regression where popup code leaks into the in-page content script.
  const contentScript = await readFile(
    path.join(builtExtensionPath, 'content-scripts/archivebox.js'),
    'utf8',
  );
  // Regression guard for the 3.0.1 tab-closing bug: that content script's
  // runtime.onMessage listener called a bare `close()` for 'hide_archivebox_overlay',
  // which resolves to the global window.close() in the page context and closed
  // the user's tab. The in-page content script must never call close() in any
  // form -- not window.close, not self.close, and not a bare close().
  expect(contentScript).not.toMatch(/window\.close/);
  expect(contentScript).not.toMatch(/self\.close/);
  expect(contentScript).not.toMatch(/(^|[^.\w])close\s*\(/);
  expect(contentScript).not.toContain('archivebox-overlay');

  const manifest = JSON.parse(
    await readFile(path.join(builtExtensionPath, 'manifest.json'), 'utf8'),
  ) as { content_scripts?: unknown[] };
  // The extension injects its content script on demand via scripting.executeScript,
  // so it should declare no statically-registered content scripts.
  expect(manifest.content_scripts ?? []).toEqual([]);
});

test('ArchiveBox server URLs are ignored before archive requests', async () => {
  const harness = await launchHarness();

  try {
    await setExtensionStorage(harness, {
      entries: [{
        id: 'server-url-entry',
        url: 'https://admin.example.com/admin/core/snapshot/',
        timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        tags: [],
        title: 'ArchiveBox Admin',
        favIconUrl: null,
        depth: 0,
      }],
      ...serverSettings('https://api.example.com', 'test-key'),
    });
    await harness.storagePage.reload({ waitUntil: 'domcontentloaded' });
    await expect(harness.storagePage.locator('body')).not.toContainText('https://admin.example.com/admin/core/snapshot/');

    for (const url of ['https://example.com/docs/', 'https://admin.example.com/admin/']) {
      const response = await sendExtensionMessage<Record<string, unknown>>(harness, {
        type: 'archivebox_add',
        server_id,
        body: {
          urls: [url],
          tags: [],
          depth: 0,
          snapshot_ids: ['019e77ba63c270009000000000000001'],
          titles: ['ArchiveBox'],
        },
      });
      expect(response).toMatchObject({
        ok: false,
        errorMessage: 'ArchiveBox server URLs are ignored.',
      });
    }

    expect(await savedEntries(harness)).toHaveLength(1);
  } finally {
    await closeHarness(harness);
  }
});

async function configureServer(harness: BrowserHarness, server: string, key: string): Promise<string> {
  const page = harness.storagePage;
  await page.getByRole('button', { name: 'Cookies', exact: true }).click();
  await expect(page.getByRole('tab').first()).toBeVisible();
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  const address = page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  await address.fill(server); await address.blur();
  const token = page.getByPlaceholder('... abcexamplekey1234 ...');
  await token.fill(key); await token.blur();
  await expect.poll(() => page.evaluate(async key => {
    const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    const { server_registry } = await api.storage.local.get('server_registry');
    return (server_registry as { servers: Array<{ token: string }> }).servers.some(server => server.token === key);
  }, key)).toBe(true);
  return page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
    return ((await api.storage.local.get('server_registry')).server_registry as { active_server_id: string }).active_server_id;
  });
}

test('saved URL bulk delete is local-first when server remove fails', async ({ archivebox }) => {
  const harness = await launchHarness();
  const source = await startFixtureServer();
  try {
    const id = await configureServer(harness, archivebox.server, archivebox.key);
    const target = await harness.context.newPage();
    const first = `${source.url}?remote-delete=${Date.now()}`;
    await target.goto(first);
    let popup = await openNativePopup(harness, target);
    const submitted = await waitForSavedEntry(harness, first, entry => Boolean((entry as Snapshot).remote_copies?.[id]?.snapshot_id), 'real submission');
    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }); popup.cdp.close();
    await configureServer(harness, archivebox.server, 'invalid-delete-test-token');
    const second = `${source.url}?local-delete=${Date.now()}`;
    await target.goto(second); popup = await openNativePopup(harness, target);
    await waitForSavedEntry(harness, second, () => true, 'local-only save');
    await waitForPopupText(harness, popup, '401');
    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }); popup.cdp.close();
    const page = harness.storagePage;
    await page.getByRole('button', { name: 'Saved URLs', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Select all visible URLs' }).check();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('.status.warning')).toContainText('Failed to delete 1 from server');
    expect(await savedEntries(harness)).toEqual([]);
    expect((await archivebox.api('/api/v1/core/snapshot/' + (submitted as Snapshot).remote_copies![id]!.snapshot_id)).url).toBe(first);
  } finally { await closeHarness(harness); await new Promise<void>(resolve => source.server.close(() => resolve())); }
});

test('persona sync updates the real remote persona while location permission is pending', async ({ archivebox }) => {
  const harness = await launchHarness();
  try {
    const serverId = await configureServer(harness, archivebox.server, archivebox.key);
    const page = harness.storagePage;
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    const name = `extension-settings-${Date.now()}`;
    page.once('dialog', dialog => dialog.accept(name));
    await page.getByRole('button', { name: 'New Profile', exact: true }).click();
    const profile = page.locator('.persona.active');
    await profile.locator('.persona-settings summary').click();
    await profile.getByLabel('User Agent', { exact: true }).fill('stale-user-agent');
    await profile.getByLabel('Viewport Size', { exact: true }).fill('800x600');
    await profile.getByLabel('Language', { exact: true }).fill('zz-ZZ');
    await profile.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(profile.locator('.persona-sync-link--synced')).toBeVisible();
    const list = async () => (await archivebox.api('/api/v1/personas/personas')).items;
    let remote = (await list()).find((item: { name: string }) => item.name === name);
    expect(remote.config.USER_AGENT).toBe('stale-user-agent');
    const remoteId = remote.id;
    await profile.getByRole('button', { name: 'Detect Settings', exact: true }).click();
    const detected = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, scale: devicePixelRatio }));
    await expect(profile.getByLabel('User Agent', { exact: true })).toHaveValue(detected.userAgent);
    await expect(profile.getByLabel('Viewport Size', { exact: true })).toHaveValue(detected.viewport);
    await expect(profile.getByLabel('Language', { exact: true })).toHaveValue(detected.language);
    await expect(page.locator('.status').filter({ hasText: /[Bb]rowser settings updated|Updated browser settings/ })).toBeVisible();
    await profile.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(async () => (await list()).find((item: { id: string }) => item.id === remoteId)?.config.USER_AGENT).toBe(detected.userAgent);
    remote = (await list()).find((item: { id: string }) => item.id === remoteId);
    expect(remote.config.CHROME_RESOLUTION).toBe(detected.viewport.replace('x', ','));
    expect(remote.config.BROWSER_LANGUAGE).toBe(detected.language);
    expect(remote.config.BROWSER_TIMEZONE).toBe(detected.timezone);
    expect(remote.config.BROWSER_DEVICE_SCALE_FACTOR).toBe(detected.scale);
    await expect(profile.locator('.persona-sync-link--synced')).toHaveAttribute('href', `${archivebox.server}/admin/personas/persona/${remoteId}/change/`);
    expect(serverId).toBeTruthy();
  } finally { await closeHarness(harness); }
});

test('saved URL sync uploads real local OPFS artifacts', async ({ archivebox }) => {
  const harness = await launchHarness();
  const source = await startFixtureServer();
  try {
    const id = await configureServer(harness, archivebox.server, 'invalid-local-capture-token');
    const page = harness.storagePage;
    const fullPage = page.getByLabel('Save full-page screenshots locally', { exact: true });
    await fullPage.click(); await expect(fullPage).toBeChecked();
    await page.getByLabel('Upload full-page screenshots to server', { exact: true }).check();
    const target = await harness.context.newPage(); await target.setViewportSize({ width: 1100, height: 360 });
    const url = `${source.url}?upload-artifacts=${Date.now()}`; await target.goto(url);
    const popup = await openNativePopup(harness, target);
    const captured = await waitForSavedEntry(harness, url, entry => Boolean(entry.screenshot && entry.mhtml), 'real local captures');
    await waitForPopupText(harness, popup, '401');
    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }); popup.cdp.close();
    await configureServer(harness, archivebox.server, archivebox.key);
    await page.getByRole('button', { name: 'Saved URLs', exact: true }).click();
    await page.locator('tbody input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(page.locator('.status.success')).toContainText('Finished syncing 1 snapshots');
    const entry = (await savedEntries(harness)).find(entry => entry.id === captured.id) as Snapshot;
    const copy = entry.remote_copies![id]!;
    const remote = await archivebox.api('/api/v1/core/snapshot/' + copy.snapshot_id);
    for (const kind of ['viewport_screenshot', 'screenshot', 'mhtml'] as const) {
      expect(copy.artifacts?.[kind]?.status).toBe('uploaded');
      const result = remote.archiveresults.find((result: { id: string }) => result.id === copy.artifacts![kind]!.archive_result_id);
      expect(result.status).toBe('succeeded'); expect(result.output_size).toBeGreaterThan(0);
      const capture = entry[kind]!;
      const paths = 'parts' in capture && capture.parts?.length ? capture.parts.map(part => part.path) : [capture.path];
      for (const filePath of paths) {
        const local = await page.evaluate(async filePath => {
          let dir = await navigator.storage.getDirectory(); const segments = filePath.split('/'); const name = segments.pop()!;
          for (const segment of segments) dir = await dir.getDirectoryHandle(segment);
          return [...new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())];
        }, filePath);
        const response = await fetch(`${archivebox.server}/snapshot/${remote.id}/${result.plugin}/${filePath.split('/').at(-1)}`, { headers: { Authorization: `Bearer ${archivebox.key}` } });
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(local));
      }
    }
  } finally { await closeHarness(harness); await new Promise<void>(resolve => source.server.close(() => resolve())); }
});

test('a real submitted URL survives removing and restoring its server configuration', async ({ archivebox }) => {
  const source = await startFixtureServer(); const harness = await launchHarness();
  try {
    const id = await configureServer(harness, archivebox.server, archivebox.key);
    const target = await harness.context.newPage(); const url = `${source.url}?connection=${Date.now()}`; await target.goto(url);
    let popup = await openNativePopup(harness, target);
    const submitted = await waitForSavedEntry(harness, url, entry => Boolean((entry as Snapshot).remote_copies?.[id]?.snapshot_id), 'real submission');
    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }); popup.cdp.close();
    const page = harness.storagePage;
    const address = page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
    await address.fill(''); await address.blur();
    await expect(address).toHaveValue('');
    popup = await openNativePopup(harness, target);
    await waitForPopupText(harness, popup, 'Connection unavailable');
    expect(await popupElementsHtml(popup, '[title="View archived copy on server"]')).toHaveLength(0);
    expect((await savedEntries(harness)).find(item => item.id === submitted.id)).toBeTruthy();
    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }); popup.cdp.close();
    await configureServer(harness, archivebox.server, archivebox.key);
    popup = await openNativePopup(harness, target);
    await waitForPopupText(harness, popup, 'Submitted');
    expect(await popupElementsHtml(popup, '.archivebox-overlay__pill--archived')).toHaveLength(1);
    expect((await archivebox.api('/api/v1/core/snapshot/' + (submitted as Snapshot).remote_copies![id]!.snapshot_id)).url).toBe(url);
    popup.cdp.close();
  } finally { await closeHarness(harness); await new Promise<void>(resolve => source.server.close(() => resolve())); }
});

test('native action popup supports local save, tags, depth, captures, navigation, and dismissal', async () => {
  test.setTimeout(45_000);
  const server = await startFixtureServer();
  const harness = await launchHarness();

  try {
    await setExtensionStorage(harness, {
      entries: [{
        id: 'seed-entry',
        url: 'https://seed.archivebox.test/',
        timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        tags: ['existing', 'research'],
        title: 'Seed entry',
        favIconUrl: null,
        depth: 0,
      }],
      ...serverSettings(''),
    });

    await harness.storagePage.reload();
    await harness.storagePage.getByRole('button', { name: 'Configuration', exact: true }).click();
    const fullPage = harness.storagePage.getByLabel('Save full-page screenshots locally', { exact: true });
    await fullPage.click(); await expect(fullPage).toBeChecked();

    const page = await harness.context.newPage();
    await page.setViewportSize({ width: 1100, height: 360 });
    const testPageUrl = `${server.url}?archivebox_test=1`;
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    expect(await extensionHasPermission(harness, 'scripting')).toBe(true);
    expect(await extensionHasPermission(harness, 'pageCapture')).toBe(true);

    let popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, 'ArchiveBox Playwright Fixture');
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    await waitForPopupText(harness, popup, 'Saved locally. Server connection unavailable.');

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

    await clickPopupButtonText(harness, popup, 'Screenshot');
    await waitForSavedEntry(
      harness,
      testPageUrl,
      (entry) => Boolean(entry.screenshot),
      'screenshot',
    );

    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }).catch(() => undefined);
    popup.cdp.close();
    await waitForNoNativePopup(harness);
    popup = await openNativePopup(harness, page);
    await clickPopupButtonText(harness, popup, 'MHTML');
    await waitForSavedEntry(
      harness,
      testPageUrl,
      (entry) => Boolean(entry.mhtml),
      'MHTML',
    );

    await harness.cdp.send('Target.closeTarget', { targetId: popup.targetId }).catch(() => undefined);
    popup.cdp.close();
    await waitForNoNativePopup(harness);
    expect(await extensionHasPermission(harness, 'scripting')).toBe(true);
    expect(await extensionHasPermission(harness, 'pageCapture')).toBe(true);

    let entries = await savedEntries(harness);
    const snapshot = entries.find((entry) => entry.url === testPageUrl);
    expect(snapshot?.tags).toContain('typedtag');
    expect(snapshot?.depth).toBe(2);
    expect(snapshot?.screenshot).toBeTruthy();
    expect(snapshot?.mhtml).toBeTruthy();
    const snapshot_id = String(snapshot?.id || '');
    expect(snapshot_id).toBeTruthy();
    expect(snapshot_id).toMatch(/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/);

    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    await clickPopupTitle(harness, popup, 'Close');
    await waitForNoNativePopup(harness);
    entries = await savedEntries(harness);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, testPageUrl);
    await clickPopupTitle(harness, popup, 'Open options');
    // runtime.openOptionsPage focuses the already-open options tab.
    await expect.poll(() => harness.storagePage.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      return (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url;
    })).toBe(`chrome-extension://${harness.extensionId}/options.html`);
    await waitForNoNativePopup(harness);

    popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    const optionsFromLocalView = harness.context.waitForEvent('page');
    await clickPopupTitle(harness, popup, 'Show in Saved URLs');
    const localViewPage = await optionsFromLocalView;
    await localViewPage.waitForURL((url) => url.searchParams.get('highlight') === snapshot_id);
    await localViewPage.close();
    await waitForNoNativePopup(harness);

    popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    await clickPopupTitle(harness, popup, 'Remove from local saved URLs');
    await waitForNoSavedEntry(harness, testPageUrl);
    await waitForNoNativePopup(harness);
    entries = await savedEntries(harness);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(false);
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test('auto-archive captures MHTML + screenshots on page load without console errors or closing the tab', async () => {
  test.setTimeout(60_000);
  const server = await startFixtureServer();
  const harness = await launchHarness();
  const messages: ConsoleMessage[] = [];

  try {
    // Real local capture exercises the
    // genuine pageCapture.saveAsMHTML + captureVisibleTab paths the user hits.
    await setExtensionStorage(harness, {
      entries: [],
      ...serverSettings(''),
      save_mhtml_locally: true,
      save_screenshots_locally: true,
      enable_auto_archive: true,
      match_urls: '.*',
    });
    const background = await collectBackgroundConsole(harness, messages);
    // give storage.onChanged time to register the auto-archive tab listener
    await sleep(500);

    const page = await harness.context.newPage();
    page.on('console', (message) => messages.push({ source: 'page', type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => messages.push({ source: 'page', type: 'error', text: error.message }));
    const testPageUrl = `${server.url}?archivebox_test=1`;
    await page.goto(testPageUrl, { waitUntil: 'load' });

    // A blank/new tab must never be archived: it is not capturable and only
    // produces permission errors and junk snapshots.
    await harness.context.newPage();

    const entry = await waitForSavedEntry(
      harness,
      testPageUrl,
      (saved) => Boolean(saved.mhtml) && Boolean(saved.screenshot),
      'auto-archived MHTML + screenshot',
      20_000,
    );
    expect(entry.tags).toContain('auto-archived');

    // The user's tab must still be open after capture finishes.
    expect(await pageTargetExists(harness, testPageUrl)).toBe(true);

    const entries = await savedEntries(harness);
    expect(entries.some((saved) => saved.url === 'about:blank')).toBe(false);
    expect(entries.every((saved) => /^https?:/i.test(String(saved.url)))).toBe(true);

    // Expected milestone log lines (action + saved artifacts + remote result).
    await waitForConsoleMessage(messages, /ArchiveBox: auto-archiving/);
    await waitForConsoleMessage(messages, /ArchiveBox: saved MHTML for/);
    await waitForConsoleMessage(messages, /ArchiveBox: saved screenshot for/);
    expect((entry as Snapshot).remote_copies).toBeUndefined();

    // No "Scripts may close..." attempt from any injected script.
    expect(consoleMessagesMatching(messages, /scripts may close/i)).toEqual([]);
    // No console errors/warnings produced by ArchiveBox itself.
    expect(archiveboxConsoleProblems(messages)).toEqual([]);
    // The popup/overlay UI must never execute inside the page the user views.
    expect(await page.locator('.archivebox-overlay').count()).toBe(0);
    expect(messages.filter((message) => (
      message.source === 'page' && /archivebox-overlay/i.test(message.text)
    ))).toEqual([]);

    background.close();
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test('action popup saves MHTML + screenshots without console errors or closing the active tab', async () => {
  test.setTimeout(60_000);
  const server = await startFixtureServer();
  const harness = await launchHarness();
  const messages: ConsoleMessage[] = [];

  try {
    await setExtensionStorage(harness, {
      entries: [],
      ...serverSettings(''),
      save_mhtml_locally: true,
      save_screenshots_locally: true,
    });
    const background = await collectBackgroundConsole(harness, messages);

    const page = await harness.context.newPage();
    // Force the real scrolling path on both large desktop displays and CI.
    // A page that fits the viewport correctly saves only viewport_screenshot.
    await page.setViewportSize({ width: 1100, height: 360 });
    page.on('console', (message) => messages.push({ source: 'page', type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => messages.push({ source: 'page', type: 'error', text: error.message }));
    const testPageUrl = `${server.url}?archivebox_test=1`;
    await page.goto(testPageUrl, { waitUntil: 'load' });

    const popup = await openNativePopup(harness, page);
    await attachConsoleCollector(popup.cdp, 'popup', messages);
    await waitForPopupText(harness, popup, testPageUrl);

    await clickPopupButtonText(harness, popup, 'MHTML');
    await waitForSavedEntry(harness, testPageUrl, (saved) => Boolean(saved.mhtml), 'popup MHTML', 15_000);

    await clickPopupButtonText(harness, popup, 'Screenshot');
    const captured = await waitForSavedEntry(harness, testPageUrl, (saved) => ((saved.screenshot as { parts?: unknown[] } | undefined)?.parts?.length || 0) > 1, 'completed full-page screenshot', 20_000);
    expect((captured.screenshot as { parts: unknown[] }).parts.length).toBeGreaterThan(1);
    await waitForPopupElementsCondition(harness, popup, 'capture finished', '.archivebox-overlay__capture-button--capturing', items => items.length === 0);

    // The page the user was viewing must still be open.
    expect(await pageTargetExists(harness, testPageUrl)).toBe(true);

    await waitForConsoleMessage(messages, /ArchiveBox: saved MHTML for/);
    await waitForConsoleMessage(messages, /ArchiveBox: saved screenshot for/);

    expect(consoleMessagesMatching(messages, /scripts may close/i)).toEqual([]);
    expect(archiveboxConsoleProblems(messages)).toEqual([]);
    // The popup/overlay UI runs only in the popup window, never in the page.
    expect(await page.locator('.archivebox-overlay').count()).toBe(0);
    expect(messages.filter((message) => (
      message.source === 'page' && /archivebox-overlay/i.test(message.text)
    ))).toEqual([]);

    background.close();
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test('popup fits mobile viewports without horizontal overflow', async () => {
  const server = await startFixtureServer();
  const harness = await launchHarness();
  try {
    await setExtensionStorage(harness, {
      entries: [],
      ...serverSettings(''),
      save_mhtml_locally: false,
      save_screenshots_locally: false,
    });
    const page = await harness.context.newPage();
    await page.goto(`${server.url}?long-url=${'a'.repeat(150)}`);
    const popupPage = await harness.context.newPage();
    await popupPage.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    await expect(popupPage.locator('.archivebox-overlay__page-title')).toContainText('ArchiveBox Playwright Fixture');
    const longTag = 'responsive-tag-'.repeat(8);
    await popupPage.getByPlaceholder('+ tag', { exact: true }).fill(longTag);
    await popupPage.getByPlaceholder('+ tag', { exact: true }).press('Enter');
    await expect(popupPage.locator('.archivebox-tag-chip--current')).toContainText(longTag);
    const touch = await harness.context.newCDPSession(popupPage);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    expect(await popupPage.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    for (const width of [320, 375, 390, 430, 560, 800]) {
      await popupPage.setViewportSize({ width, height: 900 });
      for (const menuOpen of [false, true]) {
        if (menuOpen) await popupPage.locator('.archivebox-overlay__crawl-button').click();
        const result = await popupPage.evaluate(() => ({
          width: document.querySelector('.archivebox-overlay')!.getBoundingClientRect().width,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body, #root, .archivebox-overlay, .archivebox-overlay *')]
            .filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
            }).map(el => el.className || el.tagName),
        }));
        expect(result.overflow, `viewport ${width}, menu ${menuOpen}`).toEqual([]);
        expect(result.width).toBe(Math.min(width, 560));
        expect(result.scrollWidth).toBe(width);
        if (width === 390 && !menuOpen) {
          const screenshotPath = test.info().outputPath('popup-mobile.png');
          await popupPage.screenshot({ path: screenshotPath });
          await test.info().attach('popup-mobile', { path: screenshotPath, contentType: 'image/png' });
        }
        if (menuOpen) await popupPage.locator('.archivebox-overlay__crawl-button').click();
      }
    }
    await popupPage.close();
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test('HTTP 200 from a normal website cannot confirm an ArchiveBox submission', async () => {
  const server = await startFixtureServer();
  const harness = await launchHarness();
  try {
    for (const key of ['', 'invalid-key']) {
      await setExtensionStorage(harness, serverSettings(server.url, key));
      const response = await harness.storagePage.evaluate(async (destinationId) => {
        const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
        return api.runtime.sendMessage({ type: 'archivebox_add',
        server_id: destinationId, body: { urls: ['https://example.com/post-confirmation-check'], tags: [], depth: 0 } });
      }, server_id);
      expect(response.ok).toBe(false);
      expect(response.errorMessage).toContain('did not confirm');
    }
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});
