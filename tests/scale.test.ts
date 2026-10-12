import { expect, test } from '@playwright/test';
import { launchExtension } from './helpers/extension';

// The store must stay fast and memory-bounded at the sizes users reach:
// N snapshots (100k by default, ARCHIVEBOX_SCALE_SNAPSHOTS=1000000 for the
// full check), each with 3 capture results, tags and a server receipt. Every
// user-facing read is timed against a budget, and the options page's heap
// must not grow with N.
const total = Number(process.env.ARCHIVEBOX_SCALE_SNAPSHOTS || 100_000);

type Models = {
  putSnapshots(snapshots: unknown[]): Promise<void>;
  countSnapshots(query?: object): Promise<number>;
  listSnapshots(query: object, sort: object, page: object): Promise<{ snapshots: Array<{ id: string; url: string }> }>;
  getSnapshot(id: string): Promise<unknown>;
};

test(`saved URLs stay fast with ${total} snapshots`, async ({}, testInfo) => {
  test.setTimeout(6 * 60 * 60_000);
  const harness = await launchExtension();
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await expect(page.locator('.saved-url-count')).toBeVisible();

    // Generated inside the page, written through the real store in batches.
    const seeded = performance.now();
    for (let start = 0; start < total; start += 5_000) {
      await page.evaluate(async ({ start, end }) => {
        const models = (globalThis as typeof globalThis & { archiveboxModels: Models }).archiveboxModels;
        const snapshots = [];
        for (let index = start; index < end; index++) {
          const id = index.toString(16).padStart(32, '0');
          const timestamp = new Date(Date.UTC(2020, 0, 1) + index * 60_000).toISOString();
          const dir = `users/system/snapshots/${timestamp.slice(0, 10).replaceAll('-', '')}/site${index % 5000}.example.com/${id}`;
          snapshots.push({
            id, timestamp, url: `https://site${index % 5000}.example.com/article/${index}`,
            title: `Article ${index} about topic ${index % 997}`, tags: [`tag${index % 50}`, index % 7 ? 'read' : 'unread'],
            depth: 0, favIconUrl: null, created_by_username: 'system',
            viewport_screenshot: { storage: 'opfs', path: `${dir}/chrome_extension_viewport/screenshot.png`, mimeType: 'image/png', capturedAt: timestamp, width: 1280, height: 800 },
            mhtml: { storage: 'opfs', path: `${dir}/chrome_extension_mhtml/snapshot.mhtml`, mimeType: 'multipart/related', capturedAt: timestamp, size: 120_000 },
            singlefile: { storage: 'opfs', path: `${dir}/chrome_extension_singlefile/singlefile.html`, mimeType: 'text/html', capturedAt: timestamp, size: 90_000 },
            remote_copies: { '00000000-0000-4000-8000-000000000001': { status: 'complete', submitted_to: 'https://archive.example.com', submitted_at: timestamp } },
          });
        }
        await models.putSnapshots(snapshots);
      }, { start, end: Math.min(total, start + 5_000) });
    }
    const seedSeconds = (performance.now() - seeded) / 1000;

    const timings = await page.evaluate(async (total) => {
      const models = (globalThis as typeof globalThis & { archiveboxModels: Models }).archiveboxModels;
      const time = async <T>(fn: () => Promise<T>) => {
        const started = performance.now();
        const value = await fn();
        return { ms: performance.now() - started, value };
      };
      const newest = await time(() => models.listSnapshots({}, { key: 'date', direction: 'desc' }, { offset: 0, limit: 100 }));
      const byTitle = await time(() => models.listSnapshots({}, { key: 'title', direction: 'asc' }, { offset: 0, limit: 100 }));
      const deepPage = await time(() => models.listSnapshots({}, { key: 'date', direction: 'desc' }, { offset: 5_000, limit: 100 }));
      const count = await time(() => models.countSnapshots());
      const rare = await time(() => models.listSnapshots({ search: `article/${total - 7}` }, { key: 'date', direction: 'desc' }, { offset: 0, limit: 100 }));
      const rareCount = await time(() => models.countSnapshots({ search: `article/${total - 7}` }));
      const common = await time(() => models.listSnapshots({ search: 'topic' }, { key: 'date', direction: 'desc' }, { offset: 0, limit: 100 }));
      const byId = await time(() => models.getSnapshot((total - 1).toString(16).padStart(32, '0')));
      return {
        newest: newest.ms, byTitle: byTitle.ms, deepPage: deepPage.ms, count: count.ms, countValue: count.value,
        rare: rare.ms, rareHits: rare.value.snapshots.length, rareCount: rareCount.ms, common: common.ms, byId: byId.ms,
        newestUrl: newest.value.snapshots[0]?.url,
      };
    }, total);

    // A fresh page load renders the first rows; its heap must not hold the collection.
    await page.reload();
    const opened = Date.now();
    await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(100, { timeout: 60_000 });
    const firstRender = Date.now() - opened;
    const heapMb = await page.evaluate(() => (performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6);
    await page.getByPlaceholder('Search by URL, title, or tags').fill(`article/${total - 7}`);
    const searched = Date.now();
    await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(1, { timeout: 60_000 });
    const searchRender = Date.now() - searched;

    const report = { total, seedSeconds, firstRender, searchRender, heapMb, ...timings };
    await testInfo.attach('scale.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify(report));

    expect(timings.countValue).toBe(total);
    expect(timings.rareHits).toBe(1);
    expect(timings.newestUrl).toBe(`https://site${(total - 1) % 5000}.example.com/article/${total - 1}`);
    // Budgets: indexed reads stay flat as N grows; only counting walks an index.
    expect(timings.newest).toBeLessThan(500);
    expect(timings.byTitle).toBeLessThan(500);
    expect(timings.deepPage).toBeLessThan(1_500);
    expect(timings.byId).toBeLessThan(200);
    expect(timings.rare).toBeLessThan(1_000);
    expect(timings.rareCount).toBeLessThan(1_000);
    expect(timings.common).toBeLessThan(2_000);
    expect(timings.count).toBeLessThan(3_000);
    expect(firstRender).toBeLessThan(5_000);
    expect(searchRender).toBeLessThan(5_000);
    expect(heapMb).toBeLessThan(80);
  } finally {
    await harness.close();
  }
});
