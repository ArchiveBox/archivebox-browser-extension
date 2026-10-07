import type { ArchiveReader } from '@/src/archive/reader';
export function unescapeText(value: string) { const element = document.createElement('textarea'); element.innerHTML = value; return element.value; }
export function httpURL(value: unknown, base?: string) {
  if (typeof value !== 'string') return '';
  const text = unescapeText(value).trim(); if (!text || /[\u0000-\u0020\u007f]/.test(text)) return '';
  try { const url = new URL(text, base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function sourceEntries(archive: ArchiveReader, url: string, matches: (mime: string, url: string) => boolean, limit?:number) {
  const entries = new Map<string, typeof archive.entries[number]>(); const main = archive.find(url);
  for (const entry of archive.entries) {
    if (!/^https?:/.test(entry.url) || entry.status < 200 || entry.status >= 300) continue;
    if (matches(entry.mime, entry.url) && (!entries.has(entry.url) || entry.ts > entries.get(entry.url)!.ts)) entries.set(entry.url, entry);
  }
  if (main && main.status >= 200 && main.status < 300 && /^(?:text\/|application\/(?:json|xml|xhtml\+xml))/.test(main.mime)) entries.set(main.url, main);
  const values=[...entries.values()];
  // Cards sample the main source and a few captured inputs. Full output
  // scans every source; neither path requests anything from the live site.
  return limit===undefined?values:values.sort((a,b)=>Number(b===main)-Number(a===main)).slice(0,limit);
}
export function textURLs(line: string) {
  const found: string[] = [];
  for (const match of unescapeText(line).matchAll(/https?:\/\/[^\s<>"'`“”‘’]+/gi)) {
    for (let raw of match[0].split(/,(?=https?:\/\/)/i)) {
      raw = raw.replace(/[.,;!?]+$/, '');
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) while (raw.endsWith(close!) && raw.split(close!).length > raw.split(open!).length) raw = raw.slice(0, -1);
      const url = httpURL(raw); if (url) found.push(url);
    }
  }
  return found;
}
