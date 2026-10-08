import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { launchExtension } from './helpers/extension';
import type { Snapshot } from '../src/lib/types';

test('admin-style output piles distinguish local captures and fit after refresh', async ({}, testInfo) => {
  const html = await readFile(new URL('./fixtures/auto-archive.html', import.meta.url));
  const source = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const url = `http://127.0.0.1:${address.port}/local-captures`;
  const harness = await launchExtension(['tabs', 'scripting', 'pageCapture'], ['<all_urls>']);
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    const fullPage = page.getByLabel('Save full-page screenshots locally', { exact: true });
    await fullPage.click();
    await expect(fullPage).toBeChecked();
    await page.getByPlaceholder('(wikipedia.org)|(archive.org)|(github.com/ArchiveBox/ArchiveBox/$)').fill('local-captures$');
    const automatic = page.getByLabel('Enable automatic archiving', { exact: true });
    await automatic.click();
    await expect(automatic).toBeChecked();
    const target = await harness.context.newPage();
    await target.goto(url);
    await expect.poll(() => page.evaluate(async url => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const entries = (await api.storage.local.get('entries')).entries as Snapshot[] || [];
      const entry = entries.find(entry => entry.url === url);
      return Boolean(entry?.mhtml && entry?.viewport_screenshot && entry?.screenshot);
    }, url), { timeout: 30000 }).toBe(true);
    await page.reload();
    const row = page.locator('.saved-url-table tbody tr').filter({ hasText: url });
    await expect(row.locator('.files-icon-pile')).toHaveCount(3);
    for (const kind of ['url', 'mhtml', 'viewport_screenshot', 'screenshot']) {
      await expect(row.locator(`[data-sync-kind="${kind}"]`)).toHaveAttribute('data-state', 'local');
    }
    for (const width of [320, 600, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await row.getByRole('button', { name: /^Viewport screenshot:/ }).click();
      const panel = row.locator('.files-icon-pile-popup:popover-open');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Viewport screenshot');
      await expect(panel).toContainText('Full-page screenshot');
      const bounds = await panel.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const cameras = await panel.locator('.file-delivery > svg').evaluateAll(elements => elements.map(element => element.innerHTML));
      expect(cameras).toHaveLength(2);
      expect(cameras[0]).toEqual(cameras[1]);
      await page.screenshot({ path: testInfo.outputPath(`local-piles-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    }
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});
