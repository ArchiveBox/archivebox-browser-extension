import { chromium, expect, test, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { Snapshot } from '../src/lib/types';

// Real exported Safari records, processed by the shipped options UI and saved
// through real extension storage. No API replacement or intercepted requests.
test('imports Safari exports, separates Reading List, and preserves saved URL deduplication', async ({}, testInfo) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-safari-import-'));
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
      port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then(text => text.split('\n')[0] || '').catch(() => '');
      return port;
    }).not.toBe('');
    browserInstance = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const session = await browserInstance.newBrowserCDPSession();
    const extensionPath = path.join(profile, 'extension');
    await cp(path.resolve('.output/chrome-mv3'), extensionPath, { recursive: true });
    const { id } = await session.send('Extensions.loadUnpacked', { path: extensionPath });
    const context = browserInstance.contexts()[0]!;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html?tab=import`);
    await page.getByRole('button', { name: 'Bulk Import URLs', exact: true }).click();
    await page.getByText('Import a Safari export', { exact: true }).click();
    const fileInput = page.getByLabel('Import Safari Export');
    await expect(fileInput).toBeAttached();
    const fixtures = path.resolve('tests/fixtures/safari');
    const exportedHistory = JSON.parse(await readFile(path.join(fixtures, 'History.json'), 'utf8'));
    const expectedURL = exportedHistory.history[0].url;
    const archive = path.join(profile, 'Safari Export.zip');
    // Localized filenames and macOS resource forks must not affect discovery.
    await writeFile(archive, zipSync({
      'Export/Marcadores.html': await readFile(path.join(fixtures, 'Bookmarks.html')),
      'Export/Liste de lecture.html': await readFile(path.join(fixtures, 'ReadingList.html')),
      'Export/Historial - Personal.json': await readFile(path.join(fixtures, 'History.json')),
      '__MACOSX/._Historial.json': new Uint8Array([0, 5, 22, 7]),
    }));
    await page.getByLabel('History start date').fill('2026-01-01');
    await page.getByLabel('History end date').fill('2026-12-31');
    await fileInput.setInputFiles(archive);
    const rows = page.locator('.data-table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(expectedURL);
    await expect(rows.first()).toContainText('ArchiveBox Safari Import Acceptance');

    await page.getByLabel('Safari data to import').selectOption('readingList');
    await fileInput.setInputFiles(archive);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Example Domain');
    await page.getByLabel('Safari data to import').selectOption('history');
    await fileInput.setInputFiles(path.join(fixtures, 'History.json'));
    await expect(rows).toHaveCount(1);
    await page.getByLabel('Select all visible import URLs').check();
    await page.getByRole('button', { name: 'Import Selected (1)', exact: true }).click();
    await page.getByRole('button', { name: 'Saved URLs', exact: true }).click();
    await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(1);
    const entries = await page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      return (await api.storage.local.get('entries') as { entries: Snapshot[] }).entries;
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ url: expectedURL, title: 'Example Domain', timestamp: new Date(exportedHistory.history[0].time_usec / 1000).toISOString() });

    await page.getByRole('button', { name: 'Bulk Import URLs', exact: true }).click();
    await page.getByText('Import a Safari export', { exact: true }).click();
    await page.getByLabel('Safari data to import').selectOption('all');
    await page.getByLabel('Show new only').check();
    await fileInput.setInputFiles(archive);
    await expect(page.getByText('Loaded 1 Safari URLs', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0); // Show new only excludes the URL already saved.
    await page.getByLabel('Show new only').uncheck();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole('checkbox')).toBeDisabled();
    await page.getByLabel('Safari data to import').selectOption('history');
    await page.getByLabel('History end date').fill('2026-01-02');
    await fileInput.setInputFiles(path.join(fixtures, 'History.json'));
    await expect(page.getByText('Loaded 0 Safari URLs', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    // Reject unrelated JSON, never treating arbitrary URL fields as browser history.
    await fileInput.setInputFiles(path.resolve('package.json'));
    await expect(page.getByText('No Safari bookmarks, Reading List, or history found in these files.', { exact: true })).toBeVisible();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`safari-import-${width}.png`), fullPage: true });
    }

    // Desktop popup hosts begin with a tiny viewport, then measure content.
    // Its intrinsic width must not collapse to that provisional viewport.
    await page.setViewportSize({ width: 120, height: 600 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole('region', { name: 'ArchiveBox save panel' })).toBeVisible();
    expect(await page.locator('body').evaluate(element => element.getBoundingClientRect().width)).toBe(560);
    await page.setViewportSize({ width: 560, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('popup-desktop.png') });
    // On touch devices Safari supplies the sheet width before rendering.
    const pageSession = await context.newCDPSession(page);
    await pageSession.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Crawl', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('popup-touch.png') });
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
