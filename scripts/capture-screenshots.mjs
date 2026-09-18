/** Real-browser gallery. Run after pnpm build; never writes extension state fixtures. */
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'docs/site/screenshots');
const profile = await mkdtemp(path.join(tmpdir(), 'archivebox-gallery-'));
const staging = path.join(profile, 'screenshots');
await mkdir(staging);
const sizes = [{ name: 'desktop', width: 1600, height: 1000 }, { name: 'tablet', width: 1024, height: 1366 }, { name: 'mobile', width: 390, height: 844 }];
const titles = ['Preserving the open web', 'A practical guide to personal archives', 'Research notes and reading lists', 'Digital gardens that last', 'Building a searchable knowledge library', 'Web history as a personal resource', 'Open formats for long term storage', 'Organizing bookmarks with tags', 'Saving documentation for offline use', 'Archiving photographs and illustrations', 'A collection of independent publishing', 'Keeping context with browser captures', 'Preserving community knowledge', 'Reading the web at your own pace', 'An introduction to public archives', 'Designing a resilient digital library'];
const server = createServer((req, res) => {
  const index = Number(new URL(req.url, 'http://localhost').pathname.split('/').at(-1)) || 0;
  const title = titles[index % titles.length];
  res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['reading_theme=paper; Path=/; SameSite=Lax', 'library_language=en; Path=/; SameSite=Lax', 'archive_session=gallery-public-sample; HttpOnly; Path=/; SameSite=Lax'] });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><style>body{background:#f2efe7;color:#243c35;font:20px/1.7 Georgia;margin:0}main{max-width:850px;margin:70px auto;padding:30px}small{font:14px sans-serif;letter-spacing:3px}h1{font-size:60px;line-height:1.1}aside{background:#dce6d9;padding:30px;border-radius:14px}</style><main><small>THE PUBLIC WEB · READING ROOM</small><h1>${title}</h1><p>A sample article served locally for real browser captures. This disposable reading collection demonstrates ArchiveBox without using private browsing data.</p><aside>Keep the pages that matter. Build a library you can revisit, search, and share.</aside><h2>A record worth keeping</h2><p>Independent websites hold stories, tutorials, research, and conversations. Preserving their context makes those ideas useful long after the original page changes.</p><p>Open formats and thoughtful organization help a personal archive remain accessible.</p></main></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context;
const screenshots = [];
async function capture(page, id, title, source, url = page.url().replace(/^chrome-extension:\/\/[^/]+\//, '')) {
  const entry = { id, title, url, source, images: [] };
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate(() => document.fonts.ready);
    const file = `${id}-${size.name}.png`;
    if (id.startsWith('popup')) await page.locator('.archivebox-overlay').screenshot({ path: path.join(staging, file), animations: 'disabled' });
    else await page.screenshot({ path: path.join(staging, file), fullPage: true, animations: 'disabled' });
    const png = await readFile(path.join(staging, file));
    entry.images.push({ ...size, file, imageWidth: png.readUInt32BE(16), imageHeight: png.readUInt32BE(20) });
  }
  const existing = screenshots.findIndex(item => item.id === id);
  if (existing >= 0) screenshots[existing] = entry; else screenshots.push(entry);
  console.log(`Captured ${id} (${sizes.length} viewports)`);
}
try {
  const extensionPath = path.join(profile, 'extension');
  await cp(path.join(root, '.output/chrome-mv3'), extensionPath, { recursive: true });
  const manifestFile = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  // Pregrant optional permissions in the disposable installed copy. Native
  // permission dialogs cannot be operated through Playwright's page API.
  manifest.permissions = [...new Set([...manifest.permissions, ...manifest.optional_permissions])];
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestFile, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewportSize(sizes[0]);
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.evaluate(async ({ base, titles }) => {
    const folder = await chrome.bookmarks.create({ title: 'Public web reading list' });
    for (const [index, title] of titles.entries()) await chrome.bookmarks.create({ parentId: folder.id, title, url: `${base}/reading/${index}` });
  }, { base, titles });
  const article = await context.newPage();
  await article.setViewportSize(sizes[0]);
  for (let index = 0; index < 8; index++) await article.goto(`${base}/reading/${index}`);
  const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await nav('Bulk Import URLs');
  await page.getByRole('button', { name: 'Import from Browser Bookmarks', exact: true }).click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(titles.length);
  await page.getByPlaceholder('tags,comma,separated', { exact: true }).fill('reading,research,public-web');
  await page.getByRole('checkbox', { name: 'Select all visible import URLs' }).check();
  await capture(page, 'import-bookmarks', 'Import browser bookmarks', 'src/options/OptionsApp.tsx');
  await page.getByRole('button', { name: `Import Selected (${titles.length})`, exact: true }).click();
  await nav('Saved URLs');
  await expect(page.locator('.saved-url-table tbody tr')).toHaveCount(titles.length);
  await capture(page, 'saved-urls', 'Saved URLs', 'src/options/OptionsApp.tsx');
  await page.locator('.saved-url-table thead input').check();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await capture(page, 'export-menu', 'Export saved URLs and captures', 'src/options/OptionsApp.tsx');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, 'edit-tags', 'Edit tags', 'src/options/OptionsApp.tsx');
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await nav('Configuration');
  await capture(page, 'configuration', 'Configuration', 'src/options/OptionsApp.tsx');
  await nav('Cookies');
  while (await page.locator('.persona').count()) {
    const count = await page.locator('.persona').count();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.persona').first().getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.persona')).toHaveCount(count - 1);
  }
  await page.setViewportSize(sizes[0]);
  page.once('dialog', dialog => dialog.accept('Research reading profile'));
  await page.getByRole('button', { name: 'New Profile', exact: true }).click();
  const persona = page.locator('.persona').last();
  await persona.getByRole('button', { name: 'Detect Settings', exact: true }).click();
  await expect(persona.locator('.settings-grid input').first()).not.toHaveValue('');
  await page.getByRole('button', { name: 'Load Browser Cookies', exact: true }).click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Select all visible cookie domains' }).check();
  await page.getByRole('button', { name: 'Copy Cookies to Profile ⌄', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Research reading profile', exact: true }).click();
  await expect(persona.locator('.domain-chips')).toContainText('127.0.0.1');
  await capture(page, 'cookies', 'Archiving profile and imported browser cookies', 'src/options/OptionsApp.tsx');
  await nav('Bulk Import URLs');
  await page.getByRole('checkbox', { name: 'Show new only', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Import from Browser History', exact: true }).click();
  await expect(page.locator('.data-table tbody tr').first()).toBeVisible();
  await capture(page, 'import-history', 'Import browser history', 'src/options/OptionsApp.tsx');
  await article.bringToFront();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('.archivebox-overlay__page-title')).toContainText(titles[7]);
  await popup.getByRole('button', { name: 'Screenshot', exact: true }).click();
  await expect(popup.getByTitle('Open saved screenshot')).toBeVisible({ timeout: 30000 });
  await popup.getByRole('button', { name: 'MHTML', exact: true }).click();
  await expect(popup.getByTitle('Open saved MHTML snapshot')).toBeVisible();
  await capture(popup, 'popup', 'Save the current page', 'entrypoints/popup/main.tsx');
  await popup.locator('.archivebox-overlay__crawl-button').click();
  await capture(popup, 'popup-crawl-menu', 'Choose crawl depth', 'entrypoints/popup/main.tsx');
  await popup.locator('.archivebox-overlay__crawl-button').click();
  const viewerOpened = context.waitForEvent('page');
  await popup.getByTitle('Open saved MHTML snapshot').click();
  const viewer = await viewerOpened;
  await expect(viewer.locator('.mhtml-viewer-frame')).toBeVisible();
  await capture(viewer, 'snapshot-viewer', 'Read a saved MHTML snapshot', 'src/options/OptionsApp.tsx');
  await viewer.close();
  const screenshotOpened = context.waitForEvent('page');
  await popup.getByTitle('Open saved screenshot').click();
  const screenshotViewer = await screenshotOpened;
  await expect(screenshotViewer.locator('.screenshot-viewer-frame')).toBeVisible();
  await capture(screenshotViewer, 'screenshot-viewer', 'View a saved screenshot', 'src/options/OptionsApp.tsx');
  await screenshotViewer.close();
  await nav('Saved URLs');
  await page.locator('.saved-url-table thead input').uncheck();
  await capture(page, 'saved-urls', 'Saved URLs', 'src/options/OptionsApp.tsx');
  await popup.close();
  const stores = [
    ['chrome-web-store', 'Chrome Web Store', 'https://chromewebstore.google.com/detail/archivebox-exporter/habonpimjphpdnmcfkaockjnffodikoj?hl=en', /Add to Chrome/],
    ['firefox-add-ons', 'Firefox Add-ons', 'https://addons.mozilla.org/en-US/firefox/addon/archivebox-exporter/', /Download Firefox|Add to Firefox/],
  ];
  for (const [key, title, url, action] of stores) {
    const store = await context.newPage();
    await store.setViewportSize(sizes[0]);
    const response = await store.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    if (!response?.ok()) throw new Error(`${title} returned HTTP ${response?.status()}`);
    await expect(store).toHaveTitle(/ArchiveBox/i);
    await expect(store.locator('body')).toContainText(action);
    if (/captcha|access denied|verify you are human/i.test(await store.locator('body').innerText())) throw new Error(`${title} presented a bot challenge`);
    await capture(store, key, title, null, url);
    await store.close();
  }
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ version, revision, generatedAt: new Date().toISOString(), screenshots }, null, 2) + '\n');
  await mkdir(output, { recursive: true });
  await cp(staging, output, { recursive: true });
  console.log(`Published ${screenshots.length * sizes.length} real browser screenshots to ${output}`);
} catch (error) {
  // Keep failure evidence without publishing an incomplete gallery manifest.
  await mkdir(path.join(root, 'tmp/screenshot-capture-failure'), { recursive: true });
  await cp(staging, path.join(root, 'tmp/screenshot-capture-failure'), { recursive: true });
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
