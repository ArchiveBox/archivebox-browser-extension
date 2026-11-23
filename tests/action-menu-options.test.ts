import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { launchExtension, readSnapshots, waitForSavedSettings } from './helpers/extension';
import { test as coreTest } from './helpers/archivebox';

coreTest('site history is reviewed before sending one real shared-tag crawl', async ({ archivebox }) => {
  const source = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Local menu fixture</title><p>Ordinary local history fixture.</p>');
  });
  await new Promise<void>(resolve => source.listen(0, resolve));
  const address = source.address();
  if (!address || typeof address === 'string') throw new Error('Missing local fixture port');
  const selected = [`http://127.0.0.1:${address.port}/first`, `http://127.0.0.1:${address.port}/second`];
  const unselected = `http://127.0.0.1:${address.port}/unselected`;
  const lookalike = `http://localhost:${address.port}/127.0.0.1`;
  const harness = await launchExtension(['history'], ['<all_urls>']);
  try {
    for (const url of [...selected, selected[0]!, unselected, lookalike]) {
      const visit = await harness.context.newPage();
      await visit.goto(url);
      await visit.close();
    }
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html#Configuration`);
    await expect(options.getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible();
    for (const [label, value] of [['ArchiveBox Server URL', archivebox.server], ['API Key', archivebox.key]] as const) {
      await options.getByLabel(label, { exact: true }).fill(value);
      await options.getByLabel(label, { exact: true }).blur();
      await waitForSavedSettings(options);
    }
    const requestBodies: Array<{ urls: string[]; tag: string; depth: number; only_new: boolean }> = [];
    options.on('request', request => {
      if (request.method() === 'POST' && request.url() === archivebox.server + '/api/v1/cli/add') {
        requestBodies.push(request.postDataJSON());
      }
    });

    await options.goto(`chrome-extension://${harness.id}/options.html?history_site=127.0.0.1#Import`);
    await expect(options.getByRole('heading', { name: 'Bulk Import URLs', exact: true })).toBeVisible();
    await expect(options.getByText('History review is scoped to 127.0.0.1', { exact: false })).toBeVisible();
    const start = new Date(await options.getByLabel('History start date').inputValue()).getTime();
    expect(Math.abs(Date.now() - start - 90 * 86400000)).toBeLessThan(2 * 86400000);

    await options.getByRole('button', { name: 'Load Browser History', exact: true }).click();
    await expect(options.locator('tbody tr')).toHaveCount(3);
    await expect(options.locator('tbody tr').filter({ hasText: lookalike })).toHaveCount(0);
    for (const url of selected) await options.locator('tbody tr').filter({ hasText: url }).getByRole('checkbox').check();
    expect(requestBodies).toEqual([]);
    const before = (await archivebox.api('/api/v1/crawls/crawls')).length;
    await options.getByRole('button', { name: 'Queue One Crawl (2)', exact: true }).click();
    await expect(options.getByText('Queued 2 URLs in one crawl, tagged history-127.0.0.1.', { exact: true })).toBeVisible();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({ tag: 'history-127.0.0.1', depth: 0, only_new: true });
    expect(requestBodies[0]!.urls.sort()).toEqual(selected.sort());

    const link = await options.getByRole('link', { name: /^Open Crawl / }).getAttribute('href');
    const id = new URL(link!).pathname.split('/').at(-3);
    const crawl = await archivebox.api(`/api/v1/crawls/crawl/${id}`);
    const crawlUrls = crawl.urls.trim().split('\n').map((line: string) => line.startsWith('{') ? JSON.parse(line).url : line);
    expect(crawlUrls.sort()).toEqual(selected);
    expect(crawl.tags_str).toBe('history-127.0.0.1');
    expect((await archivebox.api('/api/v1/crawls/crawls')).length).toBe(before + 1);
    const local = await readSnapshots(options);
    expect(local.map(item => item.url).sort()).toEqual(selected);
    expect(local.every(item => item.tags.includes('history-127.0.0.1')
      && Object.values(item.remote_copies || {}).some(copy => copy.crawl_id === id && copy.status === 'accepted'))).toBe(true);
    await expect(options.getByRole('button', { name: /^Queue One Crawl/ })).toBeDisabled();
    expect(requestBodies).toHaveLength(1);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  }
});

for (const result of ['partial', 'unavailable'] as const) {
  test(`site history ${result} response never falls back, resubmits or saves unconfirmed URLs`, async () => {
    const requestPaths: string[] = [];
    const crawlId = '0193a682-0000-7000-8000-000000000001';
    const server = createServer(async (request, response) => {
      if (request.method === 'POST') {
        requestPaths.push(request.url || '');
        if (request.url === '/api/v1/cli/add' && result === 'partial') {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const { urls } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { urls: string[] };
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ success: true, errors: [], result: { crawl_id: crawlId, queued_urls: urls.slice(0, 1) } }));
          return;
        }
        response.writeHead(404).end();
        return;
      }
      if (request.url?.startsWith('/api/v1/personas/personas')) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"items":[],"total_items":0}');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Local history fixture</title>');
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local fixture port');
    const harness = await launchExtension(['history'], ['<all_urls>']);
    try {
      const history = await harness.context.newPage();
      for (const path of ['/first', '/second']) await history.goto(`http://127.0.0.1:${address.port}${path}`);
      const options = await harness.context.newPage();
      await options.goto(`chrome-extension://${harness.id}/options.html#Configuration`);
      for (const [label, value] of [['ArchiveBox Server URL', `http://localhost:${address.port}`], ['API Key', 'fixture-key']] as const) {
        await options.getByLabel(label, { exact: true }).fill(value);
        await options.getByLabel(label, { exact: true }).blur();
        await waitForSavedSettings(options);
      }
      await options.goto(`chrome-extension://${harness.id}/options.html?history_site=127.0.0.1#Import`);
      await options.getByRole('button', { name: 'Load Browser History', exact: true }).click();
      await expect(options.locator('tbody tr')).toHaveCount(2);
      await options.getByRole('checkbox', { name: 'Select all visible import URLs' }).check();
      await options.getByRole('button', { name: 'Queue One Crawl (2)', exact: true }).click();
      if (result === 'partial') {
        await expect(options.getByText(`Crawl ${crawlId} confirmed 1 of 2 URLs.`, { exact: false })).toBeVisible();
        await expect(options.getByRole('link', { name: `Open Crawl ${crawlId}` })).toBeVisible();
      } else {
        await expect(options.getByText('Check the server’s Crawls before submitting again.', { exact: false })).toBeVisible();
      }
      await expect(options.getByRole('button', { name: /^Queue One Crawl/ })).toBeDisabled();
      // Saving the fixture API key separately triggers existing auth validation.
      expect(requestPaths.filter(path => path !== '/api/v1/auth/check_api_token')).toEqual(['/api/v1/cli/add']);
      expect(await readSnapshots(options)).toHaveLength(result === 'partial' ? 1 : 0);
    } finally {
      await harness.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}


test('disposable browser registers page actions and retains the original save item', async () => {
  const harness = await launchExtension();
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    const ids = ['save_to_archivebox_ctxmenu', 'archivebox-page-search', 'archivebox-page-allow',
      'archivebox-page-deny', 'archivebox-page-cookies', 'archivebox-page-history'];
    // WebExtensions has no list() for native context menus. A no-op update
    // succeeds only when the browser already has the given menu ID.
    await expect.poll(() => options.evaluate(ids => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          contextMenus: { update(id: string, changes: object, callback: () => void): void };
          runtime: { lastError?: object };
        };
      }).chrome;
      return Promise.all(ids.map(id => new Promise<string | null>(resolve => {
        api.contextMenus.update(id, {}, () => resolve(api.runtime.lastError ? null : id));
      })));
    }, ids)).toEqual(ids);
  } finally {
    await harness.close();
  }
});
