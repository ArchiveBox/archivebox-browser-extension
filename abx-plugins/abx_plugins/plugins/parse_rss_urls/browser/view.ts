import type { ViewContext, ViewResult, ViewSection } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';
import { feedURLs, parseFeed } from '../../rss/browser/feed';
export default async function(context: ViewContext): Promise<ViewResult> {
  const sections: ViewSection[] = []; const rows: (string | boolean)[][] = []; const found = new Set<string>(); let feeds = 0;
  for (const url of await feedURLs(context)) {
    const entry = context.archive.find(url);
    if (!entry) { sections.push({ type: 'text', title: 'Feed not archived', text: url }); continue; }
    try {
      const feed = parseFeed(await context.archive.text(entry), url); feeds++;
      for (const item of feed.items) {
        if (!item.url) continue;
        const key = `${url}\n${item.url}`; if (found.has(key)) continue; found.add(key);
        const parsedDate = Date.parse(item.date);
        rows.push([item.url, item.title, Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : item.date, item.tags.join(', '), url, Boolean(context.archive.find(item.url))]);
      }
    } catch (error) { sections.push({ type: 'text', title: 'Feed parse error', text: `${url}\n${String(error)}` }); }
  }
  const data=rows.map(([url,title,timestamp,tags,source_url])=>JSON.stringify({url,title,timestamp,tags,source_url})).join('\n');
  return { title: 'Feed URLs', summary: `${rows.length} article links from ${feeds} archived feeds`, sections:[],presentation:textPresentation('parse_rss_urls',data,'urls') };
}
