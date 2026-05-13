import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

type CdpTarget = {
  targetId: string;
  type: string;
  url: string;
};

type CdpClient = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
};

type BrowserHarness = {
  browser: Browser;
  context: BrowserContext;
  cdp: CdpClient;
  extensionId: string;
  process: ChildProcess;
  userDataDir: string;
};

type FixtureServer = {
  server: Server;
  url: string;
};

const extensionPath = path.resolve('.output/chrome-mv3');
const canaryPath = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';

function selectedBrowserExecutable(): string {
  if (existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (existsSync(canaryPath)) return canaryPath;
  return chromium.executablePath();
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectBrowserCdp(port: number): Promise<CdpClient> {
  const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${port}/json/version`);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Failed to open browser CDP websocket')), { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (!callbacks) return;
    if (message.error) {
      callbacks.reject(new Error(`${message.error.message}: ${message.error.data || ''}`.trim()));
      return;
    }
    callbacks.resolve(message.result || {});
  });

  return {
    send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) {
      return new Promise<T>((resolve, reject) => {
        const id = nextId += 1;
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
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
            main { min-height: 1800px; max-width: 760px; }
            section { margin-top: 720px; padding: 24px; border: 1px solid #ccd; }
          </style>
        </head>
        <body>
          <main>
            <h1>ArchiveBox Playwright Fixture</h1>
            <p id="fixture-marker">archivebox-popup-integration-fixture</p>
            <section>Lower page content for full-page screenshot capture.</section>
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
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'archivebox-extension-test-'));
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
    userDataDir,
  };
}

async function closeHarness(harness: BrowserHarness): Promise<void> {
  await harness.browser.close().catch(() => undefined);
  harness.cdp.close();
  if (!harness.process.killed) {
    harness.process.kill('SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(harness.userDataDir, { recursive: true, force: true });
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

async function grantMhtmlPermissionFromOptions(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await extensionStoragePage(context, extensionId);
  await page.bringToFront();
  await page.getByRole('button', { name: /Configuration/ }).click();
  const checkbox = page.getByLabel('Save MHTML snapshots locally');
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await extensionHasPermission(context, extensionId, 'pageCapture')) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  await expect.poll(
    () => extensionHasPermission(context, extensionId, 'pageCapture'),
    { timeout: 10_000 },
  ).toBe(true);
  await expect(checkbox).toBeChecked();
  await page.close();
}

async function waitForTabTarget(cdp: CdpClient, url: string): Promise<CdpTarget> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { targetInfos } = await cdp.send<{ targetInfos: CdpTarget[] }>('Target.getTargets', { filter: [{}] });
    const target = targetInfos.find((item) => item.type === 'tab' && item.url === url)
      || targetInfos.find((item) => item.type === 'tab' && item.url.startsWith(url));
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for tab target: ${url}`);
}

async function triggerAction(harness: BrowserHarness, page: Page): Promise<void> {
  await page.bringToFront();
  const target = await waitForTabTarget(harness.cdp, page.url());
  await harness.cdp.send('Extensions.triggerAction', {
    id: harness.extensionId,
    targetId: target.targetId,
  });
}

async function savedEntries(context: BrowserContext, extensionId: string): Promise<Array<Record<string, unknown>>> {
  return (await getExtensionStorage<Array<Record<string, unknown>>>(context, extensionId, 'entries')) || [];
}

function overlayLocator(page: Page, selector = '', options?: Parameters<Page['locator']>[1]) {
  return page.locator(`#archivebox-extension-root${selector ? ` ${selector}` : ''}`, options);
}

async function expectOverlayPinnedToViewport(page: Page): Promise<void> {
  const box = await page.locator('xpath=//*[local-name()="archivebox-extension-root"]').boundingBox();
  expect(box).toBeTruthy();
  expect(box?.y).toBeGreaterThanOrEqual(18);
  expect(box?.y).toBeLessThanOrEqual(22);
  expect(box?.x).toBeGreaterThan(0);
}

test('popup overlay supports local save, tags, depth, captures, navigation, and dismissal', async () => {
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

    await triggerAction(harness, page);
    const overlay = overlayLocator(page, '.archivebox-overlay');
    await expect(overlay).toBeVisible();
    await expectOverlayPinnedToViewport(page);
    await expect(overlay.getByText('ArchiveBox Playwright Fixture')).toBeVisible();
    await expect(overlay.getByText(server.url)).toBeVisible();
    await expect(overlay.locator('.archivebox-overlay__pill--saved', { hasText: 'Saved' })).toBeVisible();

    let entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    await overlayLocator(page, 'button.archivebox-tag-chip--suggestion', { hasText: 'existing' }).click();
    await expect(overlayLocator(page, '.archivebox-tag-chip--current', { hasText: 'existing' })).toBeVisible();

    await overlayLocator(page).getByTitle('Remove tag existing').click();
    await expect(overlayLocator(page, '.archivebox-tag-chip--current', { hasText: 'existing' })).toHaveCount(0);

    const tagInput = overlayLocator(page).getByPlaceholder('+ tag');
    await tagInput.fill('typedtag');
    await tagInput.press('Enter');
    await expect(overlayLocator(page, '.archivebox-tag-chip--current', { hasText: 'typedtag' })).toBeVisible();

    await overlayLocator(page).getByRole('button', { name: 'Crawl' }).click();
    await overlayLocator(page).getByRole('menuitem', { name: /Depth 2:/ }).click();
    await expect(overlayLocator(page).getByRole('button', { name: 'Crawl Depth: 2' })).toBeVisible();

    await overlayLocator(page).getByRole('button', { name: 'Screenshot' }).click();
    await expect(overlayLocator(page, 'button.archivebox-overlay__capture-button--saved', { hasText: 'Screenshot' })).toBeVisible({ timeout: 30_000 });
    await expectOverlayPinnedToViewport(page);

    await overlayLocator(page).getByRole('button', { name: 'MHTML' }).click();
    await expect(overlayLocator(page).getByText(/MHTML capture permission denied/)).toBeVisible();
    expect(await extensionHasPermission(harness.context, harness.extensionId, 'pageCapture')).toBe(false);
    await grantMhtmlPermissionFromOptions(harness.context, harness.extensionId);
    await page.bringToFront();
    await overlayLocator(page).getByRole('button', { name: 'MHTML' }).click();
    await expect(overlayLocator(page, 'button.archivebox-overlay__capture-button--saved', { hasText: 'MHTML' })).toBeVisible({ timeout: 30_000 });

    entries = await savedEntries(harness.context, harness.extensionId);
    const snapshot = entries.find((entry) => entry.url === testPageUrl);
    expect(snapshot?.tags).toContain('typedtag');
    expect(snapshot?.depth).toBe(2);
    expect(snapshot?.screenshot).toBeTruthy();
    expect(snapshot?.mhtml).toBeTruthy();
    const snapshotId = String(snapshot?.id || '');
    expect(snapshotId).toBeTruthy();

    const closeButton = overlayLocator(page).getByTitle('Close');
    await closeButton.click();
    await expect(overlay).toHaveCount(0);
    entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    await triggerAction(harness, page);
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(true);

    await triggerAction(harness, page);
    await expect(overlay).toBeVisible();

    const optionsFromGear = harness.context.waitForEvent('page');
    await overlayLocator(page).getByTitle('Open options').click();
    const gearPage = await optionsFromGear;
    await gearPage.waitForLoadState('domcontentloaded');
    await expect(gearPage).toHaveURL(/chrome-extension:\/\/[^/]+\/options\.html/);
    await gearPage.close();
    await page.bringToFront();

    const optionsFromLocalView = harness.context.waitForEvent('page');
    await overlayLocator(page).getByTitle('Show in Saved URLs').click();
    const localViewPage = await optionsFromLocalView;
    await localViewPage.waitForLoadState('domcontentloaded');
    expect(localViewPage.url()).toContain(`highlight=${encodeURIComponent(snapshotId)}`);
    await localViewPage.close();
    await page.bringToFront();

    await overlayLocator(page).getByTitle('Remove from local saved URLs').click();
    await expect(overlay).toHaveCount(0, { timeout: 5_000 });
    entries = await savedEntries(harness.context, harness.extensionId);
    expect(entries.some((entry) => entry.url === testPageUrl)).toBe(false);
  } finally {
    await closeHarness(harness);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});
