import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { launchExtension, readSnapshots } from './helpers/extension';

test('toolbar settings and site history links open existing sections and keep exact-host review scope', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Local menu fixture</title><p>Ordinary local history fixture.</p>');
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local fixture port');
  const selected = `http://localhost:${address.port}/saved`;
  const lookalike = `http://127.0.0.1:${address.port}/localhost`;
  const harness = await launchExtension(['history']);
  try {
    for (const url of [selected, lookalike]) {
      const visit = await harness.context.newPage();
      await visit.goto(url);
      await visit.close();
    }
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html#Configuration`);
    await expect(options.getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible();
    await options.goto(`chrome-extension://${harness.id}/options.html?history_site=localhost#Import`);
    await expect(options.getByRole('heading', { name: 'Bulk Import URLs', exact: true })).toBeVisible();
    await expect(options.getByText('History review is scoped to localhost', { exact: false })).toBeVisible();
    const start = new Date(await options.getByLabel('History start date').inputValue()).getTime();
    expect(Math.abs(Date.now() - start - 90 * 86400000)).toBeLessThan(2 * 86400000);
    await options.getByRole('button', { name: 'Load Browser History', exact: true }).click();
    await expect(options.locator('tbody tr')).toHaveCount(1);
    await expect(options.locator('tbody tr')).toContainText(selected);
    await expect(options.locator('tbody tr')).not.toContainText(lookalike);
    await options.locator('tbody input[type=checkbox]').check();
    await options.getByRole('button', { name: 'Import Selected (1)', exact: true }).click();
    await expect.poll(() => readSnapshots(options)).toEqual([expect.objectContaining({ url: selected })]);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


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
