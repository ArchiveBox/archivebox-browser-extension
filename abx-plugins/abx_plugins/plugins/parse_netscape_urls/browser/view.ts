import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';
import { httpURL } from '../../parse_txt_urls/browser/urls';
import {bookmarkSources} from './sources';
function bookmarkDate(raw: string) {
  if (!raw.trim()) return '';
  const value = Number(raw); if (!Number.isFinite(value)) return '';
  const digits = Math.trunc(Math.abs(value)).toString().length;
  const candidates: number[] = [];
  if (digits >= 9 && digits <= 11) candidates.push(value * 1000);
  if (digits >= 12 && digits <= 14) candidates.push(value);
  if (digits >= 15 && digits <= 18) candidates.push(value / 1000);
  if (digits >= 8 && digits <= 11) candidates.push((value + 978307200) * 1000);
  if (digits >= 11 && digits <= 14) candidates.push(value + 978307200000);
  for (const timestamp of candidates) { const date = new Date(timestamp); if (date.getUTCFullYear() >= 1995 && date.getUTCFullYear() <= 2035) return date.toISOString(); }
  return '';
}
export default async function({ archive, url }: ViewContext): Promise<ViewResult> {
  const rows: (string | boolean)[][] = []; let exports = 0; let rejected = 0;
  for (const {entry,source} of await bookmarkSources({archive,url})) {
    exports++;
    const doc = new DOMParser().parseFromString(source, 'text/html');
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const target = httpURL(anchor.getAttribute('href'), entry.url); if (!target) { rejected++; continue; }
      const rawDate = anchor.getAttribute('add_date') || '';
      rows.push([target, anchor.textContent?.trim() || '', bookmarkDate(rawDate), rawDate, anchor.getAttribute('tags') || '', entry.url, Boolean(archive.find(target))]);
    }
  }
  const data=rows.map(([url,title,bookmarked_at,timestamp,tags,source_url])=>JSON.stringify({url,title,bookmarked_at,timestamp,tags,source_url})).join('\n');
  return { title: 'Netscape bookmark URLs', summary: `${rows.length} bookmarks · ${exports} sources · ${rejected} omitted`, sections: [],presentation:textPresentation('parse_netscape_urls',data,'urls') };
}
