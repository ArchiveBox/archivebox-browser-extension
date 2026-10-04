import { chromium, expect, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  // Playwright's pinned Chrome for Testing still supports load-extension but
  // its CDP Extensions domain is unavailable in v148. Canary uses CDP because
  // ordinary Chrome removed that launch flag. Select the known browser's
  // supported install surface up front; do not retry a failed browser launch.
  const loadByFlag = Boolean(process.env.CHROME_FOR_TESTING_BIN) || executable === chromium.executablePath();
  const processHandle = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run',
    // Keep the new-tab page's Google requests from adding unrelated cookies
    // to the real cookie-import fixture. Test page networking stays enabled.
    '--no-default-browser-check', '--disable-background-networking', 'about:blank',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(loadByFlag ? [`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`] : []),
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
    let id: string;
    if (loadByFlag) {
      // Chrome's built-in extensions can register first. Identify our actual
      // background entry point rather than whichever worker wins that race.
      const isExtensionWorker = (url: string) => url.startsWith('chrome-extension://') && url.endsWith('/background.js');
      const worker = context.serviceWorkers().find(worker => isExtensionWorker(worker.url()))
        || await context.waitForEvent('serviceworker', { predicate: worker => isExtensionWorker(worker.url()) });
      id = new URL(worker.url()).host;
    } else {
      ({ id } = await (await browserInstance.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: extensionPath }));
    }
    return { context, id, profile, close };
  } catch (error) {
    await close();
    throw error;
  }
}
