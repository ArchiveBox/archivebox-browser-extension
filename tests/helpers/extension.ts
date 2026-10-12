import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Snapshot } from '../../src/lib/types';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function launchExtension(permissions: string[] = [], hostPermissions?: string[]) {
  const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-extension-test-'));
  const extensionPath = path.join(profile, 'extension');
  await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
  if (permissions.length || hostPermissions) {
    // These existing layout fixtures need real cookies/bookmarks without native
    // permission prompts. Only the disposable extension copy is changed.
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.permissions.push(...permissions);
    if (hostPermissions) manifest.host_permissions = hostPermissions;
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
  const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN
    || (existsSync(canary) ? canary : chromium.executablePath());
  const processHandle = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run',
    // Keep the new-tab page's Google requests from adding unrelated cookies
    // to the real cookie-import fixture. Test page networking stays enabled.
    '--no-default-browser-check', '--disable-background-networking', 'about:blank',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  processHandle.stderr?.on('data', (chunk: Buffer) => {
    browserStderr = (browserStderr + chunk.toString()).slice(-4096);
  });
  let browserInstance: Browser | undefined;
  const close = async () => {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      const exited = new Promise<void>((resolve) => processHandle.once('exit', () => resolve()));
      if (browserInstance?.isConnected()) {
        // CDP disconnect leaves browser children writing the profile. Wait for
        // graceful shutdown before deleting the disposable directory.
        await (await browserInstance.newBrowserCDPSession()).send('Browser.close');
      } else processHandle.kill('SIGTERM');
      await exited;
    }
    await browserInstance?.close();
    await rm(profile, { recursive: true, force: true });
  };
  try {
    let port = '';
    try {
      await expect.poll(async () => {
        port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then(text => text.split('\n')[0] || '').catch(() => '');
        return port;
      }).not.toBe('');
    } catch (error) {
      throw new Error(`Chromium did not open DevTools (exit ${processHandle.exitCode ?? 'running'}, ${executable}): ${browserStderr}`, { cause: error });
    }
    browserInstance = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browserInstance.contexts()[0];
    if (!context) throw new Error('Chrome did not expose its browser context');
    // CDP can initially load without Developer mode, but Chrome then disables
    // the unpacked extension on runtime.reload() (unsupportedDeveloperExtension).
    // Enable it through Chrome's real UI in this disposable development profile.
    const extensions = await context.newPage();
    await extensions.goto('chrome://extensions');
    await extensions.locator('#devMode').check();
    await extensions.close();
    const { id } = await (await browserInstance.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: extensionPath });
    return { context, id, profile, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Options-page controls show a change before the background has persisted it,
// and the page marks <main> aria-busy until every write settles (trackSave in
// OptionsApp.tsx). Await this before any step that depends on the stored value
// (a capture, opening the popup, reading storage, a reload); otherwise that
// step races the write and sees the old setting. React flushes click/input/
// change/blur handlers synchronously, so aria-busy is already set by the time
// the Playwright action that started the save resolves.
export async function waitForSavedSettings(page: Page): Promise<void> {
  await expect(page.locator('main.app[aria-busy="true"]')).toHaveCount(0);
}

// The extension's first-run migration (src/lib/storage_migration.ts) reads all
// of storage and writes it back under this Web Lock. A fixture written outside
// the lock can land between that read and write and be silently erased, so
// tests must seed storage through here. `page` is any extension page.
export async function seedExtensionStorage(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate(values => navigator.locks.request('archivebox-storage-migration', () =>
    (globalThis as typeof globalThis & { chrome: typeof browser }).chrome.storage.local.set(values)), values);
}

// Saved snapshots live in SQLite behind src/lib/models.ts, which every
// extension page and the service worker expose as globalThis.archiveboxModels.
// `page` is any extension page. Reads return every snapshot shown in Saved
// URLs, oldest first.
type Models = {
  listSnapshots(query: object, sort: object, page: object): Promise<{ snapshots: Snapshot[] }>;
  putSnapshots(snapshots: Snapshot[]): Promise<void>;
};

export async function readSnapshots(page: Page): Promise<Snapshot[]> {
  return page.evaluate(async () => {
    const models = (globalThis as typeof globalThis & { archiveboxModels: Models }).archiveboxModels;
    return (await models.listSnapshots({}, { key: 'date', direction: 'asc' }, { offset: 0, limit: 1_000_000 })).snapshots;
  });
}

export async function seedSnapshots(page: Page, snapshots: Snapshot[]): Promise<void> {
  await page.evaluate(async (list) => {
    await (globalThis as typeof globalThis & { archiveboxModels: Models }).archiveboxModels.putSnapshots(list);
  }, snapshots);
}
