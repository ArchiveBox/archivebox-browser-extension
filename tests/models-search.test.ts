import { expect, test } from '@playwright/test';
import { launchExtension, readSnapshots, seedSnapshots } from './helpers/extension';
import type { Snapshot } from '../src/lib/types';

test('searched pages retain date, title, tag, and offset semantics', async () => {
  const harness = await launchExtension();
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await expect(page.locator('.saved-url-count')).toBeVisible();
    await seedSnapshots(page, [
      ['a', 'Zulu title', 'research'],
      ['b', 'alpha title', 'research'],
      ['c', 'Beta Research', 'other'],
      ['d', 'literal "quote"', 'archive'],
      ['e', 'An unrelated row', 'misc'],
    ].map(([id, title, tag], index) => ({
      id: id!, title: title!, tags: [tag!], url: `https://example.com/article/${id}`,
      timestamp: `2026-01-0${index + 1}T00:00:00.000Z`, depth: 0,
    })));
    const results = await page.evaluate(async () => {
      const models = (globalThis as unknown as { archiveboxModels: {
        listSnapshots(query: object, sort: object, page: object): Promise<{ snapshots: Snapshot[]; hasMore: boolean }>;
      } }).archiveboxModels;
      const read = async (search: string, key: string, direction: string, offset: number, limit: number) => {
        const result = await models.listSnapshots({ search }, { key, direction }, { offset, limit });
        return { ids: result.snapshots.map(row => row.id), tags: result.snapshots.map(row => row.tags), hasMore: result.hasMore };
      };
      return {
        oldest: await read('research', 'date', 'asc', 0, 2),
        newest: await read('research', 'date', 'desc', 0, 2),
        title: await read('research', 'title', 'asc', 1, 1),
        reverseTitle: await read('research', 'title', 'desc', 1, 1),
        lastPage: await read('research', 'title', 'asc', 2, 1),
        terms: await read('research title', 'date', 'asc', 0, 10),
        quoted: await read('"quote"', 'date', 'asc', 0, 10),
        url: await read('article/e', 'date', 'desc', 0, 10),
        unfiltered: await read('', 'date', 'asc', 3, 1),
      };
    });
    expect(results.oldest).toEqual({ ids: ['a', 'b'], tags: [['research'], ['research']], hasMore: true });
    expect(results.newest.ids).toEqual(['c', 'b']);
    expect(results.title).toEqual({ ids: ['c'], tags: [['other']], hasMore: true });
    expect(results.reverseTitle.ids).toEqual(['c']);
    expect(results.lastPage).toEqual({ ids: ['a'], tags: [['research']], hasMore: false });
    expect(results.terms.ids).toEqual(['a', 'b']);
    expect(results.quoted.ids).toEqual(['d']);
    expect(results.url.ids).toEqual(['e']);
    expect(results.unfiltered).toEqual({ ids: ['d'], tags: [['archive']], hasMore: true });
  } finally {
    await harness.close();
  }
});

test('two open options pages preserve concurrent tags on the same SQLite snapshot', async () => {
  const harness = await launchExtension();
  try {
    const first = await harness.context.newPage();
    await first.goto(`chrome-extension://${harness.id}/options.html`);
    await expect(first.locator('.saved-url-count')).toBeVisible();
    await seedSnapshots(first, [{ id: 'concurrent-tags', url: 'https://archivebox.io/tests/?tags',
      timestamp: '2026-01-01T00:00:00.000Z', title: 'Concurrent tags', tags: ['original'], depth: 0 }]);
    const second = await harness.context.newPage();
    await second.goto(`chrome-extension://${harness.id}/options.html`);
    for (const [page, tag] of [[first, 'first'], [second, 'second']] as const) {
      await page.locator('.saved-url-table').getByTitle('Add tag', { exact: true }).click();
      await page.getByPlaceholder('tag', { exact: true }).fill(tag);
    }
    await Promise.all([first, second].map(page => page.getByPlaceholder('tag', { exact: true }).press('Enter')));
    await expect.poll(async () => (await readSnapshots(first))[0]?.tags.slice().sort()).toEqual(['first', 'original', 'second']);
    for (const page of [first, second]) {
      await page.reload();
      for (const tag of ['first', 'original', 'second']) {
        await expect(page.locator('.saved-url-table').getByTitle(`Remove tag ${tag}`, { exact: true })).toBeVisible();
      }
    }
  } finally {
    await harness.close();
  }
});
