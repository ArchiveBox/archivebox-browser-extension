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

test('snapshot metadata is the parent of local outputs and keeps their retention bounded', async ({}, testInfo) => {
  const harness = await launchExtension(['tabs', 'scripting', 'pageCapture'], ['<all_urls>']);
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    const configure = () => page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await configure();
    const rows = page.locator('.capture-output');
    await expect(rows.first().getByRole('heading', { name: 'Snapshot metadata', exact: true })).toBeVisible();
    const metadata = page.getByLabel('Save snapshot metadata locally', { exact: true });
    const ttl = page.getByLabel('Snapshot metadata retention', { exact: true });
    const outputLabels = ['Save viewport screenshots locally', 'Save full-page screenshots locally', 'Save MHTML snapshots locally'];
    await expect(metadata).toBeChecked();
    await expect(ttl).toHaveValue('2592000000');
    await metadata.uncheck();
    for (const label of outputLabels) await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
    await expect(ttl).toBeDisabled();
    await page.reload(); await configure();
    await expect(metadata).not.toBeChecked();
    await page.getByLabel(outputLabels[0]!, { exact: true }).check();
    await expect(metadata).toBeChecked();
    await expect(ttl).toBeEnabled();
    await ttl.selectOption('86400000');
    for (const label of ['Viewport screenshot retention', 'Full-page screenshot retention', 'MHTML retention']) {
      const select = page.getByLabel(label, { exact: true });
      await expect(select).toHaveValue('snapshot');
      await expect(select.locator('option')).toHaveText(['Same as metadata', '1 minute', '1 day']);
    }
    await page.reload(); await configure();
    await expect(metadata).toBeChecked();
    await expect(ttl).toHaveValue('86400000');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectPageFits(page);
      const parent = await rows.first().locator('.capture-output-name').boundingBox();
      const child = await rows.nth(1).locator('.capture-output-name').boundingBox();
      expect(parent && child && parent.x < child.x && parent.y < child.y).toBeTruthy();
      await page.locator('section[aria-labelledby="outputs-heading"]').screenshot({ path: testInfo.outputPath(`snapshot-metadata-${width}.png`) });
    }
  } finally { await harness.close(); }
});

test('capture retention inherits the snapshot limit and persists shorter per-type choices', async ({}, testInfo) => {
  const harness = await launchExtension();
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    const configure = () => page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await configure();
    const snapshot = page.getByLabel('Snapshot metadata retention');
    const viewport = page.getByLabel('Viewport screenshot retention', { exact: true });
    const fullPage = page.getByLabel('Full-page screenshot retention', { exact: true });
    const mhtml = page.getByLabel('MHTML retention', { exact: true });
    for (const select of [viewport, fullPage, mhtml]) {
      await expect(select).toHaveValue('snapshot');
      await expect(select.locator('option')).toHaveText(['Same as metadata', '1 minute', '1 day', '30 days']);
    }
    await snapshot.selectOption('never');
    await mhtml.selectOption('60000');
    await viewport.selectOption('86400000');
    await fullPage.selectOption('7776000000');
    await page.reload(); await configure();
    await expect(snapshot).toHaveValue('never');
    await expect(mhtml).toHaveValue('60000');
    await expect(viewport).toHaveValue('86400000');
    await expect(fullPage).toHaveValue('7776000000');
    await snapshot.selectOption('86400000');
    await expect(fullPage).toHaveValue('86400000');
    for (const select of [viewport, fullPage, mhtml]) {
      await expect(select.locator('option')).toHaveText(['Same as metadata', '1 minute', '1 day']);
    }
    await fullPage.selectOption('snapshot');
    await page.reload(); await configure();
    await expect(fullPage).toHaveValue('snapshot');
    await expect(mhtml).toHaveValue('60000');
    await expect(viewport).toHaveValue('86400000');
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expectPageFits(page);
      await page.screenshot({ path: testInfo.outputPath(`capture-retention-${width}.png`), fullPage: true });
    }
  } finally { await harness.close(); }
});

test('concurrent retention edits survive closing their options tabs immediately', async () => {
  const harness = await launchExtension();
  try {
    const openSettings = async () => {
      const page = await harness.context.newPage();
      await page.goto(`chrome-extension://${harness.id}/options.html`);
      await page.getByRole('button', { name: 'Configuration', exact: true }).click();
      return page;
    };
    const first = await openSettings();
    await first.getByLabel('Snapshot metadata retention').selectOption('never');
    const pages = [first, await openSettings(), await openSettings()];
    const choices = [
      ['MHTML retention', '60000'],
      ['Viewport screenshot retention', '86400000'],
      ['Full-page screenshot retention', '7776000000'],
    ] as const;
    await Promise.all(pages.map(async (page, index) => {
      const [label, value] = choices[index]!;
      await page.getByLabel(label, { exact: true }).selectOption(value);
      await page.close();
    }));
    const reopened = await openSettings();
    await expect(reopened.getByLabel('Snapshot metadata retention')).toHaveValue('never');
    for (const [label, value] of choices) await expect(reopened.getByLabel(label, { exact: true })).toHaveValue(value);
  } finally { await harness.close(); }
});

test('local retention defaults to 30 days and persists every choice', async ({}, testInfo) => {
  const harness = await launchExtension();
  const { context, id } = harness;
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.getByLabel('Save viewport screenshots locally', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Save full-page screenshots locally', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Save MHTML snapshots locally', { exact: true })).toBeChecked();
    const retention = page.getByLabel('Snapshot metadata retention');
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
    await expect(page.getByLabel('Upload viewport screenshots to server', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Upload full-page screenshots to server', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Upload MHTML snapshots to server', { exact: true })).toBeChecked();
    await page.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
    await page.reload();
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.getByLabel('Save viewport screenshots locally', { exact: true })).not.toBeChecked();
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
