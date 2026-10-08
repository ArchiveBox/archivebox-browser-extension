import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { launchExtension } from './helpers/extension';

test('automatic archiving obeys changed URL patterns and the off switch', async () => {
  const document = await readFile(new URL('./fixtures/auto-archive.html', import.meta.url));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(document);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  const harness = await launchExtension(['tabs'], ['<all_urls>']);
  try {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.id}/options.html`);
    await options.getByRole('button', { name: 'Configuration', exact: true }).click();
    await options.getByLabel('Save viewport screenshots locally', { exact: true }).uncheck();
    await options.getByLabel('Save MHTML snapshots locally', { exact: true }).uncheck();
    const match = options.locator('.field').filter({ has: options.getByText('Match URL regex', { exact: true }) }).locator('input');
    const exclude = options.locator('.field').filter({ has: options.getByText('Exclude URL regex', { exact: true }) }).locator('input');
    const enabled = options.getByLabel('Enable automatic archiving', { exact: true });
    const entries = () => options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      return (await api.storage.local.get('entries')).entries || [];
    });
    const visit = async (name: string) => {
      const page = await harness.context.newPage();
      await page.goto(`${origin}/${name}`);
      await page.waitForTimeout(1000);
      await page.close();
    };
    await match.fill('.*');
    await enabled.click();
    await expect(enabled).toBeChecked();
    await visit('allowed');
    await expect.poll(entries).toEqual([expect.objectContaining({ url: `${origin}/allowed`, tags: ['auto-archived'] })]);
    for (const pattern of ['.*', '(.*)', '127\\.0\\.0\\.1', 'excluded|private']) {
      await exclude.fill('');
      await exclude.pressSequentially(pattern);
      await options.reload();
      await options.getByRole('button', { name: 'Configuration', exact: true }).click();
      await expect(exclude).toHaveValue(pattern);
      await visit('excluded');
      await visit('excluded-again');
      expect(await entries()).toHaveLength(1);
    }
    await exclude.fill('');
    await enabled.uncheck();
    await visit('disabled');
    expect(await entries()).toHaveLength(1);
    await enabled.click();
    await expect(enabled).toBeChecked();
    await match.fill('allowed$');
    await visit('unmatched');
    expect(await entries()).toHaveLength(1);
    await match.fill('.*');
    await exclude.fill('[');
    await visit('invalid-exclusion');
    expect(await entries()).toHaveLength(1);
    await exclude.fill('');
    await match.fill('[');
    await visit('invalid-match');
    expect(await entries()).toHaveLength(1);
    await match.fill('');
    await visit('empty-match');
    expect(await entries()).toHaveLength(1);
    await match.fill('.*');
    await visit('re-enabled');
    await expect.poll(entries).toHaveLength(2);
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
