import { expect, test } from '@playwright/test';
import { siteCookieSource, siteHostname, siteRulePatch, siteUrlPattern } from '../src/lib/siteRules';

test('native-menu domain rules match exact hosts, never substring lookalikes', () => {
  const pattern = new RegExp(siteUrlPattern('www.example.com'));
  expect(pattern.test('https://www.example.com/path')).toBe(true);
  expect(pattern.test('https://www.example.com./path')).toBe(true);
  expect(pattern.test('http://www.example.com:8080/')).toBe(true);
  for (const url of ['https://www.example.com.evil.test/', 'https://evil.test/?www.example.com', 'https://wwwXexampleXcom/', 'https://sub.www.example.com/']) {
    expect(pattern.test(url)).toBe(false);
  }
  expect(siteHostname('https://WWW.EXAMPLE.COM./path')).toBe('www.example.com');
  expect(siteHostname('chrome://settings')).toBeNull();
  expect(siteHostname('https://secret@example.com/')).toBeNull();
});

test('enabling one domain never revives a disabled global allow rule', () => {
  const patch = siteRulePatch('.*', '', false, 'example.com', true);
  expect(patch.enable_auto_archive).toBe(true);
  expect(new RegExp(patch.match_urls!).test('https://example.com/')).toBe(true);
  expect(new RegExp(patch.match_urls!).test('https://unrelated.test/')).toBe(false);
});

test('allow and deny compose with existing enabled policy without weakening unrelated exclusions', () => {
  const patch = siteRulePatch('^https://existing\\.test/', 'private|^https://blocked\\.test/', true, 'example.com', true);
  const allow = new RegExp(patch.match_urls!);
  const deny = new RegExp(patch.exclude_urls);
  expect(allow.test('https://existing.test/')).toBe(true);
  expect(allow.test('https://example.com/private')).toBe(true);
  expect(deny.test('https://example.com/private')).toBe(false);
  expect(deny.test('https://existing.test/private')).toBe(true);
  expect(deny.test('https://blocked.test/')).toBe(true);
  const blocked = siteRulePatch(patch.match_urls!, patch.exclude_urls, true, 'example.com', false);
  expect(new RegExp(blocked.exclude_urls).test('https://example.com/')).toBe(true);
  expect(new RegExp(blocked.exclude_urls).test('https://existing.test/private')).toBe(true);
  expect(() => siteRulePatch('[', '', false, 'example.com', true)).toThrow();
});

test('Persona navigation strips query and fragment and rejects embedded credentials', () => {
  expect(siteCookieSource('https://Example.com/login/page?token=dummy#secret')).toBe('https://example.com/login/page');
  expect(siteCookieSource('https://user:password@example.com/')).toBeNull();
  expect(siteCookieSource('chrome://settings')).toBeNull();
  expect(siteCookieSource('https://example.com:8443/path')).toBe('https://example.com:8443/path');
});
