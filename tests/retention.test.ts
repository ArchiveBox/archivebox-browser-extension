import { launchExtension } from './helpers/extension';
import type { ServerRegistry } from '../src/lib/types';
import { expect, test, type Page } from '@playwright/test';

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

test('local retention defaults to 30 days and persists every choice', async ({}, testInfo) => {
  const harness = await launchExtension();
  const { context, id } = harness;
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.getByRole('heading', {name:'Local archiving',exact:true})).toBeVisible();
    await expect(page.getByText('WACZ files stay local until you delete them.', {exact:false})).toBeVisible();
    await expect(page.getByLabel('Save MHTML snapshots locally', {exact:true})).toHaveCount(0);
    const retention = page.getByLabel('After saving on server, remove legacy local copies after:');
    await expect(retention).toHaveValue('2592000000');
    await expect(retention.locator('option')).toHaveText(['1 minute', '1 day', '30 days', '90 days', 'never']);
    for (const value of ['60000', '86400000', '7776000000', 'never', '2592000000']) {
      await retention.selectOption(value);
      await expect.poll(() => page.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
        return String((await api.storage.local.get('local_retention_ms')).local_retention_ms);
      })).toBe(value);
      await page.reload();
      await page.getByRole('button', { name: 'Configuration', exact: true }).click();
      await expect(retention).toHaveValue(value);
    }
    const retentionBox = await retention.boundingBox();
    const automaticBox = await page.getByRole('heading', { name: 'Automatic Archiving', exact: true }).boundingBox();
    expect(retentionBox && automaticBox && retentionBox.y < automaticBox.y).toBeTruthy();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expectPageFits(page);
      await page.screenshot({ path: testInfo.outputPath('retention-' + width + '.png'), fullPage: true });
    }
    // Existing records hidden by a newly configured server must survive unrelated
    // snapshot transactions (the same storage path used by TTL cleanup).
    await page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      await api.storage.local.set({ entries: [
        { id: 'unsent-hidden', url: 'http://127.0.0.1:18764/page', title: 'Unsent hidden', timestamp: new Date().toISOString(), tags: [] },
        { id: 'unsent-visible', url: 'https://example.com/visible', title: 'Unsent visible', timestamp: new Date().toISOString(), tags: [] },
      ] });
    });
    await page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').fill('http://127.0.0.1:18764');
    await page.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com').blur();
    await expect.poll(() => page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const { server_registry } = await api.storage.local.get('server_registry');
      return (server_registry as ServerRegistry | undefined)?.servers[0]?.server;
    })).toBe('http://127.0.0.1:18764');
    await page.reload();
    await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Select all visible URLs' }).check();
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await page.getByPlaceholder('Add tag', { exact: true }).fill('retained');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      return (await api.storage.local.get('entries')).entries;
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unsent-hidden', tags: [] }),
      expect.objectContaining({ id: 'unsent-visible', tags: ['retained'] }),
    ]));
  } finally {
    await harness.close();
  }
});
