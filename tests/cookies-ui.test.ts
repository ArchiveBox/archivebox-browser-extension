import { expect, test } from '@playwright/test';
import { launchExtension } from './helpers/extension';
import type { Persona } from '../src/lib/types';

test('cookie picker groups sites, preserves precise selections and imports into the viewed persona', async ({}, testInfo) => {
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    const { context, id } = harness;
    await context.addCookies([
      ...['facebook.com', 'instagram.com', 'google.com', 'accounts.google.com', 'mail.google.com', 'youtube.com', 'github.com', 'reddit.com', 'netflix.com', 'amazon.com', 'wikipedia.org', 'nytimes.com', 'aaa-unlisted.com', 'news.bbc.co.uk', 'www.bbc.co.uk', 'alice.github.io', 'bob.github.io', 'localhost', '127.0.0.1'].map(domain => ({
        name: 'login', value: `session-${domain}`, domain, path: '/', sameSite: 'Lax' as const,
      })),
      { name: 'secure-login', value: 'keep-attributes', domain: '.google.com', path: '/account', secure: true, httpOnly: true, sameSite: 'Strict' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Private', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByLabel('Profile name')).toHaveValue('Work');
    // Browsing a persona does not silently change the profile used for captures.
    const stored = () => page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      return await api.storage.local.get(['personas', 'active_persona']) as { personas: Persona[]; active_persona: string };
    });
    const initial = await stored();
    expect(initial.personas.find(item => item.id === initial.active_persona)?.name).toBe('Private');
    await page.getByRole('button', { name: /^(Load Browser Cookies|Refresh cookies)$/ }).click();
    const groups = page.locator('.cookie-site');
    await expect(groups).toHaveCount(16);
    expect(await groups.first().getAttribute('data-site')).toBe('facebook.com');
    const google = page.locator('.cookie-site[data-site="google.com"]');
    await expect(google.locator('[title="4 cookies"]')).toBeVisible();
    await google.getByRole('button', { name: 'Show domains for Google' }).click();
    await google.getByRole('checkbox', { name: 'Select accounts.google.com', exact: true }).check();
    await expect(google.getByRole('checkbox', { name: 'Select Google', exact: true })).toBeChecked({ indeterminate: true });
    await google.getByRole('checkbox', { name: 'Select Google', exact: true }).check();
    await expect(page.getByText('3 domains selected', { exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search sites or domains' }).fill('bbc');
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute('data-site', 'bbc.co.uk');
    await page.getByRole('checkbox', { name: 'Select all visible cookie domains' }).check();
    await expect(page.getByText('5 domains selected', { exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search sites or domains' }).fill('not-present');
    await expect(page.getByText('No matching sites', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('cookies-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Add to Work', exact: true }).click();
    await expect.poll(async () => Object.keys((await stored()).personas.find(item => item.name === 'Work')!.cookies).sort()).toEqual([
      'accounts.google.com', 'google.com', 'mail.google.com', 'news.bbc.co.uk', 'www.bbc.co.uk',
    ]);
    const work = (await stored()).personas.find(item => item.name === 'Work')!;
    expect(work.cookies['google.com']!.find(cookie => cookie.name === 'secure-login')).toMatchObject({
      value: 'keep-attributes', domain: '.google.com', path: '/account', secure: true, httpOnly: true, sameSite: 'strict',
    });
    expect((await stored()).personas.find(item => item.name === 'Private')!.cookies).toEqual({});
    await page.getByRole('button', { name: 'Remove accounts.google.com', exact: true }).click();
    await expect.poll(async () => Object.keys((await stored()).personas.find(item => item.name === 'Work')!.cookies).length).toBe(4);
    expect((await stored()).personas.find(item => item.name === 'Work')!.cookies['google.com']).toHaveLength(2);
    await page.getByRole('button', { name: 'Use for archiving', exact: true }).click();
    await expect.poll(async () => (await stored()).active_persona).toBe(work.id);
    await page.reload();
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(page.getByLabel('Profile name')).toHaveValue('Work');
    await page.getByRole('button', { name: /^(Load Browser Cookies|Refresh cookies)$/ }).click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cookies-${width}.png`), fullPage: true });
    }
    const longName = 'Research and personal archiving with a very long profile name';
    await page.getByLabel('Profile name').fill(longName);
    await page.getByLabel('Profile name').blur();
    const longDomain = 'my-very-long-browser-profile-login.department.example.net';
    await context.addCookies([{ name: 'login', value: 'long-domain-layout', domain: longDomain, path: '/' }]);
    await page.getByRole('button', { name: 'Refresh cookies', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search sites or domains' }).fill(longDomain);
    const longSite = page.locator('.cookie-site[data-site="example.net"]');
    await longSite.getByRole('checkbox', { name: 'Select example.net', exact: true }).check();
    await longSite.getByRole('button', { name: 'Show domains for example.net', exact: true }).click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const tabs = await page.getByRole('tab').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
      expect(new Set(tabs).size).toBe(1);
      expect(await page.evaluate(() => [...document.querySelectorAll('.cookies-panel button, .cookies-panel input, .cookie-domains label')].every(element => {
        const rect = element.getBoundingClientRect();
        return rect.width === 0 || (rect.left >= 0 && rect.right <= innerWidth);
      }))).toBe(true);
      await expect(page.getByRole('tab', { name: longName, exact: true })).toHaveAttribute('title', longName);
      await page.screenshot({ path: testInfo.outputPath(`cookies-long-labels-${width}.png`), fullPage: true });
    }
  } finally {
    await harness.close();
  }
});

test('large profiles show every site immediately in dense rows with only four common sites prioritized', async ({}, testInfo) => {
  const harness = await launchExtension(['cookies', 'tabs', 'scripting'], ['<all_urls>']);
  try {
    const common = ['facebook.com', 'instagram.com', 'google.com', 'youtube.com', 'github.com', 'reddit.com', 'amazon.com', 'nytimes.com', 'netflix.com', 'wikipedia.org'];
    const other = Array.from({ length: 140 }, (_, index) => `a-research-${String(index + 1).padStart(3, '0')}.test`);
    await harness.context.addCookies([...common, ...other].flatMap(domain => ['login', 'preferences'].map(name => ({ name, value: 'layout-fixture', domain, path: '/' }))));
    const page = await harness.context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`chrome-extension://${harness.id}/options.html`);
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    const rows = page.locator('.cookie-site');
    await expect(rows).toHaveCount(150);
    await expect(rows.nth(4)).toHaveAttribute('data-site', 'a-research-001.test');
    expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(34);
    expect((await rows.first().boundingBox())!.y).toBeLessThan(380);
    await page.getByRole('checkbox', { name: 'Select all visible cookie domains' }).check();
    await page.getByRole('button', { name: 'Add to Private', exact: true }).click();
    await expect(page.locator('.persona-identity')).toContainText('150 sites');
    await expect(page.locator('.persona-identity')).toContainText('300 cookies');
    await page.reload();
    await page.getByRole('button', { name: 'Cookies', exact: true }).click();
    await expect(rows).toHaveCount(150);
    await expect(page.locator('.cookie-saved')).toHaveCount(150);
    await page.screenshot({ path: testInfo.outputPath('cookies-300-logins.png') });
    await page.getByRole('button', { name: 'In profile', exact: true }).click();
    await expect(rows).toHaveCount(150);
    await page.getByRole('searchbox', { name: 'Search sites or domains' }).fill('research-140');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-site', 'a-research-140.test');
  } finally { await harness.close(); }
});
