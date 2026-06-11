import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

const builtExtensionPath = path.resolve('.output/chrome-mv3');
const testExtensionBasePath = path.resolve('tmp/chrome-mv3-playwright');
const canaryPath = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const chromeProfileBasePath = path.resolve('tmp/chrome_profile');
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

async function waitForLoadedExtensionId(remoteDebuggingPort: number, timeoutMs = 15_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targets = await waitForJson<DevToolsTarget[]>(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
    const worker = targets.find((target) => (
      (target.type === 'service_worker' || target.type === 'background_page')
      && /^chrome-extension:\/\/[a-p]{32}\/background\.js/.test(target.url)
    ));
    const match = worker?.url.match(/^chrome-extension:\/\/([a-p]{32})\//);
    if (match?.[1]) return match[1];
    await sleep();
  }
  throw new Error('Timed out waiting for the extension service worker to register');
}

async function launchHarness(): Promise<BrowserHarness> {
  const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const extensionPath = await prepareTestExtensionPath(path.join(testExtensionBasePath, runId));
  const executablePath = selectedBrowserExecutable();
  const remoteDebuggingPort = await freePort();
  const userDataDir = path.join(chromeProfileBasePath, runId);
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  let activeUserDataDir = userDataDir;
  let browserProcess = spawnBrowser(executablePath, activeUserDataDir, remoteDebuggingPort, []);
  await waitForJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
  let cdp = await connectBrowserCdp(remoteDebuggingPort);

  let extensionId: string;
  try {
    const loaded = await cdp.send<{ id: string }>('Extensions.loadUnpacked', { path: extensionPath });
    extensionId = loaded.id;
  } catch (error) {
    if (!/method not available|not found|extensions/i.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
    // Chrome <149 does not expose the CDP Extensions domain over the websocket
    // endpoint, so fall back to the --load-extension launch flag it still
    // supports and discover the generated extension ID from its service worker.
    // Relaunch into a fresh profile dir (rather than wiping and reusing the
    // first one, which races with the just-killed browser releasing the dir).
    cdp.close();
    browserProcess.kill('SIGTERM');
    await waitForProcessExit(browserProcess);
    const firstUserDataDir = activeUserDataDir;
    activeUserDataDir = `${userDataDir}-loadext`;
    await mkdir(activeUserDataDir, { recursive: true });
    browserProcess = spawnBrowser(executablePath, activeUserDataDir, remoteDebuggingPort, [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ]);
    await waitForJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
    extensionId = await waitForLoadedExtensionId(remoteDebuggingPort);
    cdp = await connectBrowserCdp(remoteDebuggingPort);
    await rm(firstUserDataDir, { recursive: true, force: true }).catch(() => undefined);
  }

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
    userDataDir: activeUserDataDir,
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
    item.type === 'service_worker' && /\/background\.js/.test(item.url)
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
          const text = normalize(element.textContent || '');
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

async function writeOpfsFile(harness: BrowserHarness, filePath: string, content: string, type: string): Promise<void> {
  await harness.storagePage.evaluate(async ({ path: opfsPath, text, mimeType }) => {
    const root = await navigator.storage.getDirectory();
    const segments = opfsPath.split('/');
    const fileName = segments.pop();
    if (!fileName) throw new Error('Invalid OPFS test path');
    let directory = root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    const file = await directory.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Blob([text], { type: mimeType }));
    await writable.close();
  }, {
    path: filePath,
    text: content,
    mimeType: type,
  });
}

async function listOpfsFiles(harness: BrowserHarness, directoryPath: string): Promise<string[]> {
  return await harness.storagePage.evaluate(async (pathPrefix) => {
    const root = await navigator.storage.getDirectory();
    let directory = root;
    for (const segment of pathPrefix.split('/')) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const files: string[] = [];
    async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
      for await (const [name, handle] of (dir as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
      }).entries()) {
        const nextPath = `${prefix}/${name}`;
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, nextPath);
        else files.push(nextPath);
      }
    }
    await walk(directory, pathPrefix);
    return files;
  }, directoryPath);
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
      archivebox_server_url: 'https://api.example.com',
      archivebox_api_key: 'test-key',
    });
    await harness.storagePage.reload({ waitUntil: 'domcontentloaded' });
    await expect(harness.storagePage.locator('body')).not.toContainText('https://admin.example.com/admin/core/snapshot/');

    for (const url of ['https://example.com/docs/', 'https://admin.example.com/admin/']) {
      const response = await sendExtensionMessage<Record<string, unknown>>(harness, {
        type: 'archivebox_add',
        body: {
          urls: [url],
          tags: [],
          depth: 0,
          snapshotIds: ['019e77ba63c270009000000000000001'],
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

test('saved URL bulk delete is local-first when server remove fails', async () => {
  const harness = await launchHarness();

  try {
    await setExtensionStorage(harness, {
      entries: [
        {
          id: 'remote-entry',
          url: 'https://remote-delete-failure.example/',
          timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          tags: [],
          title: 'Remote delete failure',
          favIconUrl: null,
          depth: 0,
          archiveboxCrawlId: 'crawl-id',
        },
        {
          id: 'local-entry',
          url: 'https://local-delete.example/',
          timestamp: new Date('2026-01-02T00:00:00.000Z').toISOString(),
          tags: [],
          title: 'Local delete',
          favIconUrl: null,
          depth: 0,
        },
      ],
      archivebox_server_url: 'https://api.example.com',
      archivebox_api_key: 'test-key',
    });
    await harness.storagePage.route('https://api.example.com/api/v1/cli/remove', (route) => {
      route.fulfill({ status: 502, body: 'Bad Gateway' });
    });
    await harness.storagePage.reload({ waitUntil: 'domcontentloaded' });
    await expect(harness.storagePage.locator('tbody tr')).toHaveCount(2);
    await harness.storagePage.locator('thead input[type="checkbox"]').check();
    await expect(harness.storagePage.locator('text=2 selected')).toBeVisible();
    harness.storagePage.once('dialog', (dialog) => dialog.accept());
    await harness.storagePage.getByRole('button', { name: 'Delete' }).click();
    await expect(harness.storagePage.locator('tbody tr')).toHaveCount(0);
    await expect(harness.storagePage.locator('text=0 selected')).toBeVisible();
    await expect(harness.storagePage.locator('.status.warning')).toContainText('Failed to delete 1 from server');
    expect(await savedEntries(harness)).toEqual([]);
  } finally {
    await closeHarness(harness);
  }
});

test('persona sync can update an already synced remote persona after detecting settings', async () => {
  const harness = await launchHarness();
  const personaId = '019e77ba63c270009000000000000201';
  const payloads: Array<Record<string, unknown>> = [];

  try {
    await setExtensionStorage(harness, {
      archivebox_server_url: 'https://api.example.com',
      archivebox_api_key: 'test-key',
      personas: [{
        id: personaId,
        name: 'Persona update test',
        created: new Date('2026-01-04T00:00:00.000Z').toISOString(),
        lastUsed: null,
        cookies: {},
        settings: {
          userAgent: 'stale-user-agent',
          viewport: '800x600',
          viewportScale: '2',
          language: 'zz-ZZ',
          timezone: 'Etc/UTC',
          geolocation: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 25,
          },
        },
      }],
      activePersona: personaId,
    });
    await harness.storagePage.route('https://ipapi.co/json/', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ city: 'Test City', country_name: 'Test Country' }),
      });
    });
    await harness.storagePage.route('https://api.example.com/api/v1/personas/sync', async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      payloads.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          created: payloads.length === 1,
          persona: {
            id: '019e77ba63c270009000000000000301',
            name: 'Persona update test',
          },
        }),
      });
    });
    await harness.storagePage.reload({ waitUntil: 'domcontentloaded' });
    await harness.storagePage.getByRole('button', { name: 'Cookies' }).click({ timeout: 5_000 });

    await harness.storagePage.getByRole('button', { name: 'Sync to Server' }).click({ timeout: 5_000 });
    await expect(harness.storagePage.locator('.persona-sync-link--synced')).toBeVisible();
    await expect.poll(() => payloads.length).toBe(1);
    const firstPayload = payloads[0];
    if (!firstPayload) throw new Error('Missing first persona sync payload');
    expect((firstPayload.settings as Record<string, unknown>).user_agent).toBe('stale-user-agent');

    await harness.storagePage.getByRole('button', { name: 'Detect Settings' }).click({ timeout: 5_000 });
    await expect(harness.storagePage.locator('.status.success')).toContainText('Updated browser settings');
    const detectedSettings = await harness.storagePage.evaluate(() => ({
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth},${window.innerHeight}`,
      viewportScale: window.devicePixelRatio || 1,
    }));

    await harness.storagePage.getByRole('button', { name: 'Sync to Server' }).click({ timeout: 5_000 });
    await expect.poll(() => payloads.length).toBe(2);
    const secondPayload = payloads[1];
    if (!secondPayload) throw new Error('Missing second persona sync payload');
    const secondSettings = secondPayload.settings as Record<string, unknown>;
    expect(secondPayload.extension_persona_id).toBe(personaId);
    expect(secondSettings.user_agent).toBe(detectedSettings.userAgent);
    expect(secondSettings.language).toBe(detectedSettings.language);
    expect(secondSettings.timezone).toBe(detectedSettings.timezone);
    expect(secondSettings.viewport_size).toBe(detectedSettings.viewport);
    expect(secondSettings.viewport_device_scale_factor).toBe(detectedSettings.viewportScale);
    await expect(harness.storagePage.locator('.persona-sync-link--synced')).toHaveAttribute('href', 'https://api.example.com/admin/personas/persona/019e77ba63c270009000000000000301/change/');
  } finally {
    await closeHarness(harness);
  }
});

test('saved URL sync uploads local OPFS artifacts', async () => {
  const harness = await launchHarness();
  const snapshotId = '019e77ba63c270009000000000000002';
  const serverSnapshotId = '019e77ba63c270009000000000000102';
  const snapshotUrl = 'https://upload-artifacts.example/';
  const screenshotPath = `snapshots/20260103/upload-artifacts.example/${snapshotId}/chrome_extension_screenshot/screenshot.png`;
  const mhtmlPath = `snapshots/20260103/upload-artifacts.example/${snapshotId}/chrome_mhtml/snapshot.mhtml`;
  const archiveResultBodies: string[] = [];
  const patchedBodies: string[] = [];

  try {
    await setExtensionStorage(harness, {
      entries: [{
        id: snapshotId,
        url: snapshotUrl,
        timestamp: new Date('2026-01-03T12:00:00.000Z').toISOString(),
        tags: ['local-artifact'],
        title: 'Upload artifacts',
        favIconUrl: null,
        depth: 1,
        screenshot: {
          storage: 'opfs',
          path: screenshotPath,
          parts: [{ path: screenshotPath, x: 0, y: 0, width: 1, height: 1 }],
          mimeType: 'image/png',
          capturedAt: new Date('2026-01-03T00:00:01.000Z').toISOString(),
          width: 1,
          height: 1,
        },
        mhtml: {
          storage: 'opfs',
          path: mhtmlPath,
          mimeType: 'multipart/related',
          capturedAt: new Date('2026-01-03T00:00:02.000Z').toISOString(),
          size: 12,
        },
      }],
      archivebox_server_url: 'https://api.example.com',
      archivebox_api_key: 'test-key',
    });
    await writeOpfsFile(harness, screenshotPath, 'png-bytes', 'image/png');
    await writeOpfsFile(harness, mhtmlPath, 'mhtml-bytes', 'multipart/related');
    expect(await listOpfsFiles(harness, `snapshots/20260103/upload-artifacts.example/${snapshotId}`)).toEqual(expect.arrayContaining([
      screenshotPath,
      mhtmlPath,
    ]));

    await harness.storagePage.route('https://api.example.com/api/v1/cli/add', async (route) => {
      const body = route.request().postDataJSON() as {
        depth?: number;
        snapshot_ids?: string[];
        titles?: string[];
      };
      expect(body.depth).toBe(1);
      expect(body.snapshot_ids).toEqual([snapshotId]);
      expect(body.titles).toEqual(['Upload artifacts']);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            snapshot_ids: [snapshotId],
            crawl_id: 'crawl-id',
          },
        }),
      });
    });
    await harness.storagePage.route('https://api.example.com/api/v1/core/snapshots', (route) => {
      const body = route.request().postDataJSON() as { id?: string };
      expect(body.id).toBe(snapshotId);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: serverSnapshotId }) });
    });
    await harness.storagePage.route('https://api.example.com/api/v1/core/archiveresults', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      expect(body).toContain(`name="snapshot_id"\r\n\r\n${serverSnapshotId}`);
      archiveResultBodies.push(body);
      const plugin = body.includes('chrome_mhtml') ? 'chrome_mhtml' : 'chrome_extension_screenshot';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: `${plugin}-result`, output_files: {} }),
      });
    });
    await harness.storagePage.route(/https:\/\/api\.example\.com\/api\/v1\/core\/archiveresult\/.+/, async (route) => {
      patchedBodies.push(route.request().postDataBuffer()?.toString('latin1') || '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await harness.storagePage.reload({ waitUntil: 'domcontentloaded' });
    expect(await listOpfsFiles(harness, `snapshots/20260103/upload-artifacts.example/${snapshotId}`)).toEqual(expect.arrayContaining([
      screenshotPath,
      mhtmlPath,
    ]));
    await expect(harness.storagePage.locator('tbody tr')).toHaveCount(1);
    await harness.storagePage.locator('tbody input[type="checkbox"]').check();
    await harness.storagePage.getByRole('button', { name: 'Sync' }).click();
    await expect(harness.storagePage.locator('.status.success')).toContainText('Finished syncing 1 snapshots');

    expect(archiveResultBodies.length).toBeGreaterThan(0);
    expect(patchedBodies.length).toBeGreaterThan(0);
    expect(patchedBodies.some((body) => body.includes('screenshot.png'))).toBe(true);
    expect(patchedBodies.some((body) => body.includes('snapshot.mhtml'))).toBe(true);
    expect(patchedBodies.every((body) => !body.includes('.part-000000'))).toBe(true);
  } finally {
    await closeHarness(harness);
  }
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
      archivebox_server_url: '',
      archivebox_api_key: '',
      archivebox_test_fast_capture: true,
    });

    const page = await harness.context.newPage();
    const testPageUrl = `${server.url}?archivebox_test=1`;
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    expect(await extensionHasPermission(harness, 'scripting')).toBe(true);
    expect(await extensionHasPermission(harness, 'pageCapture')).toBe(true);

    let popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, 'ArchiveBox Playwright Fixture');
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    await waitForPopupText(harness, popup, 'Sync failed');

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
    const snapshotId = String(snapshot?.id || '');
    expect(snapshotId).toBeTruthy();
    expect(snapshotId).toMatch(/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/);

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
    const optionsFromGear = harness.context.waitForEvent('page');
    await clickPopupTitle(harness, popup, 'Open options');
    const gearPage = await optionsFromGear;
    await gearPage.waitForLoadState('domcontentloaded');
    await expect(gearPage).toHaveURL(/chrome-extension:\/\/[^/]+\/options\.html/);
    await gearPage.close();
    await waitForNoNativePopup(harness);

    popup = await openNativePopup(harness, page);
    await waitForPopupText(harness, popup, testPageUrl);
    await waitForPopupText(harness, popup, 'Saved');
    const optionsFromLocalView = harness.context.waitForEvent('page');
    await clickPopupTitle(harness, popup, 'Show in Saved URLs');
    const localViewPage = await optionsFromLocalView;
    await localViewPage.waitForLoadState('domcontentloaded');
    expect(localViewPage.url()).toContain(`highlight=${encodeURIComponent(snapshotId)}`);
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
    // Real local capture (no archivebox_test_fast_capture) so this exercises the
    // genuine pageCapture.saveAsMHTML + captureVisibleTab paths the user hits.
    await setExtensionStorage(harness, {
      entries: [],
      archivebox_server_url: '',
      archivebox_api_key: '',
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
    await waitForConsoleMessage(messages, /no ArchiveBox server configured/);

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
      archivebox_server_url: '',
      archivebox_api_key: '',
      save_mhtml_locally: true,
      save_screenshots_locally: true,
    });
    const background = await collectBackgroundConsole(harness, messages);

    const page = await harness.context.newPage();
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
    await waitForSavedEntry(harness, testPageUrl, (saved) => Boolean(saved.screenshot), 'popup screenshot', 20_000);

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
