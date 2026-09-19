import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../docs/site/_site/', import.meta.url));
const prefix = '/';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw new Error('Outside the site prefix');
    const relative = pathname.slice(prefix.length) + (pathname.endsWith('/') ? 'index.html' : '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) throw new Error('Outside the site directory');
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const canary = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const executablePath = process.env.CHROME_BIN || (existsSync(chromium.executablePath()) ? chromium.executablePath() : canary);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const failedLocalResources = [];
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) failedLocalResources.push(response.url());
  });
  const manifest = JSON.parse(await readFile(path.join(root, 'screenshots/manifest.json'), 'utf8'));
  const evidence = fileURLToPath(new URL('../test-results/site/', import.meta.url));
  await mkdir(evidence, { recursive: true });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['', 'screenshots/']) {
      await page.goto(`${origin}${prefix}${route}`);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('aside, .contents')).toHaveCount(0);
      const content = await page.locator('main').boundingBox();
      assert(content && Math.abs(content.x - (width - content.x - content.width)) <= 1, `${route || 'README'} is not centered at ${width}px`);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert(fits, `${route || 'README'} overflows at ${width}px`);
      if (route) {
        await expect(page.locator('article.capture')).toHaveCount(manifest.screenshots.length);
        await expect(page.locator('.provenance')).toContainText(manifest.revision.slice(0, 12));
        for (const profile of ['desktop', 'tablet', 'mobile']) {
          await page.locator(`button[data-profile="${profile}"]`).click();
          await expect(page.locator(`button[data-profile="${profile}"]`)).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('figure:visible')).toHaveCount(manifest.screenshots.length);
          for (const image of await page.locator('figure:visible img').all()) {
            await image.scrollIntoViewIfNeeded();
            await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
          }
        }
      } else {
        await expect(page.locator('#screenshots')).toBeVisible();
        const previews = page.locator(`main img[src^="${prefix}"]`);
        assert(await previews.count() > 0, 'README needs a generated screenshot preview');
        for (const image of await previews.all()) {
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${route ? 'gallery' : 'home'}-${width}.png`) });
    }
  }
  assert.deepEqual(pageErrors, [], 'Site JavaScript errors');
  assert.deepEqual(failedLocalResources, [], 'Missing site assets');
  console.log(`Verified README and ${manifest.screenshots.length} screenshot views at 390px and 1280px under ${prefix}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
