import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';
import { httpURL, sourceEntries, unescapeText } from '../../parse_txt_urls/browser/urls';
const field = (record: Record<string, unknown>, keys: string[]) => keys.map(key => record[key]).find(value => typeof value === 'string' && value.trim()) as string | undefined;
function date(record: Record<string, unknown>) {
  const original = field(record, ['bookmarked_at', 'time', 'created_at', 'created', 'date', 'bookmarked', 'saved']);
  // Canonical JSONL bookmarks use microseconds; JavaScript Dates use milliseconds.
  const timestamp = original ? Date.parse(original) : typeof record.timestamp === 'number' ? record.timestamp / 1000 : NaN;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : original || '';
}
export default async function({ archive, url, preview }: ViewContext): Promise<ViewResult> {
  const sources = sourceEntries(archive, url, (mime, source) => /(?:json|ndjson|jsonl)|^text\/plain/i.test(mime) || /\.(?:jsonl|ndjson)(?:[?#]|$)/i.test(source), preview?3:undefined);
  const rows: (string | number | boolean)[][] = []; const errors: (string | number)[][] = []; const tags = new Set<string>(); let documents = 0;
  for (const entry of sources) {
    const source = await archive.text(entry);
    if (!/^[\[{]/.test(source.trimStart())) continue;
    documents++;
    const records: { record: unknown; line: number }[] = [];
    try {
      const parsed = JSON.parse(source);
      for (const record of Array.isArray(parsed) ? parsed : [parsed]) records.push({ record, line: 1 });
    } catch {
      source.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      try { records.push({ record: JSON.parse(line), line: index + 1 }); }
      catch (error) { errors.push([entry.url, index + 1, String(error)]); return; }
      });
    }
    for (const { record: parsed, line } of records) {
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') continue;
      const record = parsed as Record<string, unknown>;
      const target = httpURL(field(record, ['href', 'url', 'URL'])); if (!target) continue;
      const title = unescapeText((field(record, ['title', 'description', 'name']) || '').replace(/ — Readability$/, '').trim());
      const values = Array.isArray(record.tags) ? record.tags.filter(tag => typeof tag === 'string') : typeof record.tags === 'string' ? record.tags.split(record.tags.includes(',') ? ',' : /\s+/) : [];
      const itemTags = values.map(tag => unescapeText(tag).trim()).filter(Boolean); itemTags.forEach(tag => tags.add(tag));
      rows.push([target, title, date(record), itemTags.join(', '), entry.url, line, Boolean(archive.find(target))]);
    }
  }
  const data=rows.map(([url,title,bookmarked_at,tags,source_url,line])=>JSON.stringify({url,title,bookmarked_at,tags,source_url,line})).join('\n');
  return { title: 'JSONL bookmark URLs', summary: `${rows.length} bookmark records · ${documents} sources · ${errors.length} malformed lines`, sections: [],presentation:textPresentation('parse_jsonl_urls',data,'urls') };
}
