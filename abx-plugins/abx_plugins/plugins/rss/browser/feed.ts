import type { ViewContext } from '@/src/archive/views';
export type FeedItem = { title: string; url: string; date: string; author: string; summary: string; tags: string[] };
export type Feed = { title: string; description: string; items: FeedItem[] };
const child = (parent: Element, name: string) => [...parent.children].find(el => el.localName === name);
const value = (parent: Element, name: string) => child(parent, name)?.textContent?.trim() || '';
const string = (value: unknown) => typeof value === 'string' ? value : '';
function resolve(value: string, base: string) {
  try { const url = new URL(value, base); return value && /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
/** Shared offline feed parser for feed inspection and URL extraction. */
export function parseFeed(source: string, sourceURL: string): Feed {
  if (source.trimStart().startsWith('{')) {
    const data = JSON.parse(source);
    if (typeof data.version !== 'string' || !data.version.startsWith('https://jsonfeed.org/version/') || !Array.isArray(data.items)) throw Error('Not a JSON Feed document');
    return { title: string(data.title), description: string(data.description), items: data.items.filter((item: unknown) => item && typeof item === 'object').map((item: Record<string, unknown>) => ({
      title: string(item.title) || string(item.id), url: resolve(string(item.url) || string(item.external_url), sourceURL), date: string(item.date_published) || string(item.date_modified),
      author: Array.isArray(item.authors) ? item.authors.map(author => string(author?.name)).filter(Boolean).join(', ') : string((item.author as { name?: string })?.name),
      summary: string(item.summary) || string(item.content_text), tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [],
    })) };
  }
  if (/<!doctype|<!entity|<!notation|<(?:xi|xinclude):include/i.test(source)) throw Error('Feed XML contains external-loading declarations');
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw Error('Invalid feed XML');
  const root = xml.documentElement;
  if (!['rss', 'feed', 'RDF'].includes(root.localName)) throw Error(`Not RSS or Atom: ${root.localName}`);
  const channel = child(root, 'channel') || root;
  const baseFor = (element: Element) => {
    const ancestors: Element[] = []; let current: Element | null = element;
    while (current) { ancestors.unshift(current); current = current.parentElement; }
    let base = sourceURL;
    for (const ancestor of ancestors) { const part = ancestor.getAttribute('xml:base'); if (part) base = resolve(part, base) || base; }
    return base;
  };
  return { title: value(channel, 'title'), description: value(channel, 'description') || value(channel, 'subtitle'),
    items: [...xml.getElementsByTagName('*')].filter(el => el.localName === 'item' || el.localName === 'entry').map(item => {
      const link = [...item.children].find(el => el.localName === 'link' && (!el.getAttribute('rel') || el.getAttribute('rel') === 'alternate'));
      const author = child(item, 'author'); const guid = child(item, 'guid');
      const target = link?.getAttribute('href') || link?.textContent?.trim() || (guid?.getAttribute('isPermaLink') !== 'false' ? guid?.textContent?.trim() : '') || '';
      return { title: value(item, 'title') || value(item, 'id') || value(item, 'guid'), url: resolve(target, baseFor(link || item)),
        date: value(item, 'pubDate') || value(item, 'published') || value(item, 'updated') || value(item, 'date'),
        author: author ? value(author, 'name') || author.textContent?.trim() || '' : value(item, 'creator'), summary: value(item, 'description') || value(item, 'summary'),
        tags: [...item.children].filter(el => el.localName === 'category' || el.localName === 'subject').map(el => el.getAttribute('term') || el.textContent?.trim() || '').filter(Boolean),
      };
    }),
  };
}
export async function feedURLs({ archive, url }: ViewContext) {
  const urls = new Set<string>(); const main = archive.find(url);
  if (main && /(?:xml|json|rss|atom)/i.test(main.mime)) urls.add(main.url);
  for (const entry of archive.entries) if (/(?:application|text)\/(?:rss\+xml|atom\+xml|feed\+json)/i.test(entry.mime) || /^https?:.*\.(?:rss|atom)(?:[?#]|$)/i.test(entry.url)) urls.add(entry.url);
  if (archive.documentEntry()) {
    const doc = await archive.sourceDOM();
    for (const el of doc.querySelectorAll('link[rel~="alternate"][href]')) {
      if (!/(?:rss|atom|feed\+json)/i.test(el.getAttribute('type') || '')) continue;
      const target = resolve(el.getAttribute('href')!, doc.baseURI || url); if (target) urls.add(target);
    }
  }
  // Supplemental capture follows redirects; its final response can be plain
  // application/xml at an API URL. Resolve the discovery URL to that recorded
  // response instead of reporting a missing feed or relying on its suffix.
  const refs=archive.metadata?.plugins?.find((plugin:any)=>plugin.id==='rss')?.hooks.flatMap((hook:any)=>hook.records||[])||[];
  for(const ref of refs){
    const entry=archive.find(ref.url,ref.ts);if(!entry)continue;
    const record=await archive.headers(entry),metadata=JSON.parse(record.warcHeaders['WARC-JSON-Metadata']||'{}');
    if(metadata.requestedUrl)urls.delete(metadata.requestedUrl);
    urls.add(entry.url);
  }
  return urls;
}
