import type { ViewContext, ViewResult } from '@/src/archive/views';
import {cardDOM} from '@/src/archive/cards';
import {textPresentation} from '@/src/ui/canonical-text';

export default async function({ archive, url, preview }: ViewContext): Promise<ViewResult> {
  const doc = await (preview?cardDOM(archive):archive.dom());
  let base = url;
  try { base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || url, url).href; } catch { /* use capture URL */ }
  const found = new Map<string, { kind: string; url: string; label: string; count: number }>();
  let ignored = 0;
  const add = (kind: string, raw: string | null, label = '') => {
    if (!raw?.trim()) return;
    try {
      const target = new URL(raw, base);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) { ignored++; return; }
      const key = `${kind}\n${target.href}`;
      const old = found.get(key);
      if (old) old.count++;
      else found.set(key, { kind, url: target.href, label: label.replace(/\s+/g, ' ').trim(), count: 1 });
    } catch { ignored++; }
  };
  const rules = [
    ['a[href],area[href]', 'href', 'Navigation'], ['img[src]', 'src', 'Image'],
    ['script[src]', 'src', 'Script'], ['iframe[src],frame[src]', 'src', 'Frame'],
    ['audio[src],video[src],source[src],track[src]', 'src', 'Media'], ['video[poster]', 'poster', 'Poster'],
    ['object[data]', 'data', 'Object'], ['embed[src]', 'src', 'Embed'], ['form[action]', 'action', 'Form'],
  ];
  for (const [selector, attr, kind] of rules) {
    for (const el of doc.querySelectorAll(selector!)) add(kind!, el.getAttribute(attr!), el.getAttribute('alt') || el.textContent || '');
  }
  for (const el of doc.querySelectorAll('link[href]')) add(el.getAttribute('rel')?.split(/\s+/).includes('stylesheet') ? 'Stylesheet' : `Link: ${el.getAttribute('rel') || 'unspecified'}`, el.getAttribute('href'));
  for (const el of doc.querySelectorAll('[srcset]')) {
    // A URL token can contain commas (notably data URLs); descriptors end at a comma.
    let value = el.getAttribute('srcset') || '';
    while (value) {
      value = value.replace(/^[\s,]+/, '');
      const token = /^\S+/.exec(value)?.[0];
      if (!token) break;
      value = value.slice(token.length);
      add('Responsive image', token.replace(/,+$/, ''));
      if (!token.endsWith(',')) {
        const comma = value.indexOf(',');
        value = comma < 0 ? '' : value.slice(comma + 1);
      }
    }
  }
  for (const css of [...doc.querySelectorAll('style,[style]')].map(el => el.tagName === 'STYLE' ? el.textContent || '' : el.getAttribute('style') || '')) {
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) add('Inline CSS resource', match[1] || match[2] || match[3] || null);
  }
  const data=[...found.values()].map(row=>JSON.stringify({url:row.url,title:row.label,type:row.kind,source_url:url})).join('\n');
  return { title: 'DOM links', summary: `${found.size} URLs · ${ignored} omitted`, sections: [],presentation:textPresentation('parse_dom_outlinks',data,'urls') };
}
