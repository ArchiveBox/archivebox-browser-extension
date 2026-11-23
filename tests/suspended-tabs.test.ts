import { expect, test } from '@playwright/test';
import { archiveableTabPage } from '../src/lib/archiveboxUrlExclusions';

const marvellous = 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html';
const other = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const original = 'https://example.com/a%2Fb?q=a+b&uri=literal&token=%26#part&second';
const title = 'C++ & browser tabs';

test('Marvellous and Great Suspender preserve the entire original address and title', () => {
  for (const placeholder of [marvellous, other + '/suspended.html']) {
    expect(archiveableTabPage({
      url: `${placeholder}#ttl=${encodeURIComponent(title)}&pos=10&uri=${original}`,
      title: 'Suspended Tab',
    })).toEqual({ url: original, title, favIconUrl: null, suspended: true });
  }
});

test('encoded suspender URL formats decode only the wrapper', () => {
  for (const url of [
    `${other}/suspended/suspended.html#u=${encodeURIComponent(original)}&t=${encodeURIComponent(title)}`,
    `${other}/suspended.html#uri=${encodeURIComponent(original)}&ttl=${encodeURIComponent(title)}`,
    `${other}/park.html?tabId=123&title=${encodeURIComponent(title)}&url=${encodeURIComponent(original)}&sessionId=456`,
  ]) {
    expect(archiveableTabPage({ url })).toEqual({ url: original, title, favIconUrl: null, suspended: true });
  }
});

test('native discarding preserves the page URL and marks it as suspended', () => {
  const tab = { url: original, title, favIconUrl: 'https://example.com/favicon.ico' };
  expect(archiveableTabPage(tab)).toEqual({ ...tab, suspended: false });
  expect(archiveableTabPage({ ...tab, discarded: true })).toEqual({ ...tab, suspended: true });
});

test('unrelated browser pages and invalid suspended targets are skipped', () => {
  for (const url of [
    'chrome://settings/',
    `${other}/options.html?url=${encodeURIComponent(original)}`,
    `${marvellous}#ttl=Known&pos=10`,
    `${marvellous}#uri=javascript%3Aalert(1)`,
    `${marvellous}#uri=file:///private/page.html`,
    `${marvellous}#uri=chrome-extension://${other}/suspended.html`,
    `${marvellous}#uri=https%3A%2F%2F`,
  ]) expect(archiveableTabPage({ url })).toBeNull();
});
