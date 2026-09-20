import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Snapshot } from '../src/lib/types';

async function expectPageFits(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>('main button, main input, main select, main nav, main table, main footer')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      }).map((element) => `${element.tagName}.${element.className}: ${element.textContent?.trim()}`),
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.overflowing).toEqual([]);
}

test('options sections and saved URL actions fit mobile and desktop viewports', async ({}, testInfo) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-options-responsive-'));
  const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
  const executable = process.env.CHROME_FOR_TESTING_BIN || process.env.CHROME_BIN
    || (existsSync(canary) ? canary : chromium.executablePath());
  const processHandle = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run',
    '--no-default-browser-check', ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ], { stdio: 'ignore' });
  let browserInstance: Browser | undefined;
  try {
    let port = '';
    await expect.poll(async () => {
      port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then((text) => text.split('\n')[0] || '').catch(() => '');
      return port;
    }).not.toBe('');
    browserInstance = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const session = await browserInstance.newBrowserCDPSession();
    const extensionPath = path.join(profile, 'extension');
    await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // Pregrant permissions in the disposable test copy: native permission prompts
    // are outside Playwright's page UI, while all data and imports remain real.
    manifest.permissions.push('cookies', 'bookmarks');
    manifest.host_permissions = ['<all_urls>'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    const { id } = await session.send('Extensions.loadUnpacked', { path: extensionPath });
    const context = browserInstance.contexts()[0];
    if (!context) throw new Error('Chrome did not expose its browser context');
    const page = await context.newPage();
    await context.addCookies([{ name: 'layout', value: 'cookie-table', domain: 'responsive-layout.example.com', path: '/' }]);
    await page.goto(`chrome-extension://${id}/options.html`);
    // Real extension storage records exercise long URLs, titles, and tags.
    await page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      await api.bookmarks.create({ title: 'A long bookmark title for testing mobile import rows', url: 'https://example.com/' + 'long-path-segment/'.repeat(12) });
      await api.storage.local.set({ entries: [{
        id: 'responsive-layout-entry',
        url: `https://example.com/${'long-url-segment/'.repeat(12)}`,
        title: 'A long saved page title that should remain readable on a small phone screen',
        timestamp: new Date().toISOString(), tags: ['mobile', 'a-long-tag-name-with-no-spaces-to-test-wrapping'],
        favIconUrl: null, depth: 0,
      }] });
    });
    const screenshot = await page.screenshot();
    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle('responsive-layout.png', { create: true });
      const writer = await file.createWritable();
      await writer.write(new Uint8Array(bytes));
      await writer.close();
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const { entries } = await api.storage.local.get('entries') as { entries: Snapshot[] };
      const snapshot = entries[0];
      if (!snapshot) throw new Error('Missing saved URL fixture');
      snapshot.screenshot = {
        storage: 'opfs', path: 'responsive-layout.png', mimeType: 'image/png',
        capturedAt: new Date().toISOString(), width: window.innerWidth, height: window.innerHeight,
      };
      await api.storage.local.set({ entries });
    }, [...screenshot]);
    await page.reload();
    await expect(page.locator('.snapshot-screenshot-thumb')).toBeVisible();
    await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(1);

    for (const width of [320, 375, 390, 430, 600, 601, 768, 900, 901, 1024, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('navigation').getByRole('button', { name: 'Saved URLs', exact: true }).click();
      await expectPageFits(page);
      for (const button of await page.locator('.saved-url-toolbar .icon-button').all()) {
        expect((await button.boundingBox())?.height).toBeLessThanOrEqual(40);
      }
      const count = await page.locator('.saved-url-count').boundingBox();
      const search = await page.locator('.saved-url-toolbar .search-field').boundingBox();
      expect(count && search && (count.y + count.height <= search.y + 1 || count.x + count.width <= search.x + 1)).toBeTruthy();
      const selectAll = await page.locator('.saved-url-table thead input').boundingBox();
      const selectRow = await page.locator('.saved-url-table tbody input[type="checkbox"]').boundingBox();
      expect(selectAll && selectRow && Math.abs(selectAll.x - selectRow.x)).toBeLessThanOrEqual(2);
      await page.locator('.saved-url-table thead input').check();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectPageFits(page);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('button', { name: 'Tags', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectPageFits(page);
      await page.getByRole('button', { name: 'cancel', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`saved-urls-${width}.png`), fullPage: true });
      if (width === 320 || width === 1280) {
        const viewerPromise = context.waitForEvent('page');
        await page.locator('.snapshot-screenshot-link').click();
        const viewer = await viewerPromise;
        await viewer.setViewportSize({ width, height: 844 });
        await expect(viewer.locator('.screenshot-viewer-frame')).toBeVisible();
        await expectPageFits(viewer);
        await viewer.screenshot({ path: testInfo.outputPath(`screenshot-viewer-${width}.png`), fullPage: true });
        await viewer.close();
      }

      for (const name of ['Configuration', 'Cookies', 'Bulk Import URLs']) {
        await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
        if (name === 'Cookies' && width === 320) {
          const originalProfileCount = await page.locator('.persona').count();
          page.once('dialog', (dialog) => dialog.accept('Mobile archiving profile'));
          await page.getByRole('button', { name: 'New Profile', exact: true }).click();
          await expect(page.locator('.persona')).toHaveCount(originalProfileCount + 1);
          await page.locator('.persona').last().getByRole('button', { name: 'Detect Settings', exact: true }).click();
          await expect(page.locator('.persona').last().locator('.settings-grid input').first()).not.toHaveValue('');
          await page.getByRole('button', { name: 'Load Browser Cookies', exact: true }).click();
          await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
        }
        if (name === 'Bulk Import URLs' && width === 320) {
          await page.getByRole('button', { name: 'Import from Browser Bookmarks', exact: true }).click();
          await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
        }
        await expectPageFits(page);
        await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase().replaceAll(' ', '-')}-${width}.png`), fullPage: true });
      }
    }
  } finally {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      const exited = new Promise<void>((resolve) => processHandle.once('exit', () => resolve()));
      if (browserInstance?.isConnected()) {
        // CDP disconnect alone leaves Chromium's children writing the profile.
        // Ask the browser to shut down gracefully before deleting its files.
        const shutdown = await browserInstance.newBrowserCDPSession();
        await shutdown.send('Browser.close');
      } else processHandle.kill('SIGTERM');
      await exited;
    }
    await browserInstance?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
