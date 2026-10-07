import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';

export default async function({ archive, url }: ViewContext): Promise<ViewResult> {
  const documentEntry = archive.find(url);
  const entry = documentEntry && /html/i.test(documentEntry.mime) ? documentEntry : archive.documentEntry();
  if (!entry) return { title: 'HTML URLs', summary: '', sections: [],presentation:textPresentation('parse_html_urls','','urls') };
  const source = await archive.text(entry);
  const doc = new DOMParser().parseFromString(source, 'text/html');
  let base = url;
  try { base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || url, url).href; } catch { /* use capture URL */ }
  const found = new Map<string, Set<string>>();
  const add = (raw: string, from: string) => {
    try {
      const target = new URL(raw, base);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) return;
      target.hash = '';
      if (target.href === url.split('#')[0]) return;
      const sources = found.get(target.href) || new Set<string>();
      sources.add(from); found.set(target.href, sources);
    } catch { /* invalid reference */ }
  };
  for (const el of doc.querySelectorAll('a[href],area[href]')) add(el.getAttribute('href')!, 'href');
  for (const match of source.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
    const decoded = new DOMParser().parseFromString(`<body>${match[0].replace(/&(?!(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);)/gi, '&amp;')}</body>`, 'text/html').body.textContent || '';
    add(decoded.replace(/[),.;!?\]}]+$/, ''), 'literal');
  }
  const data=[...found].sort(([a],[b])=>a.localeCompare(b)).map(([target,sources])=>JSON.stringify({url:target,type:[...sources].join(', '),source_url:url})).join('\n');
  return { title: 'HTML URLs', summary: `${found.size} unique outgoing HTTP URLs`, sections: [],presentation:textPresentation('parse_html_urls',data,'urls') };
}
