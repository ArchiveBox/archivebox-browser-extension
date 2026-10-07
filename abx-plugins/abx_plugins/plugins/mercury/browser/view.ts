import { preserveArticleImageDimensions } from '@/src/archive/article';
import { mercury } from './parser';
import type { ViewContext, ViewResult } from '@/src/archive/views';
import { replayHTML } from '@/src/archive/replay';
export default async function({ archive, url }: ViewContext): Promise<ViewResult> {
  const doc = await archive.dom();
  const Parser = await mercury();
  // The browser build materializes elements through jQuery while extracting.
  // Rewrite first so incidental image loads read the WACZ, never the live site.
  const html = await replayHTML(archive, doc.documentElement.outerHTML, url);
  const result = await Parser.parse(url, { html, contentType: 'html', fetchAllPages: false });
  if (result.error) throw Error(result.message || 'Postlight Parser could not parse this document');
  if (result.failed || !result.content) return { title: 'Mercury article', summary: 'Postlight Parser found no article in the archived DOM', sections: [] };
  const { content: extracted, ...metadata } = result;
  // Canonical mercury hook: unescape once only when output is heavily escaped.
  let content = extracted;
  const escapedCount = (content.match(/&lt;|&gt;/g) || []).length;
  const tagCount = (content.match(/</g) || []).length;
  if (escapedCount && escapedCount > tagCount * 2) {
    const decoder = document.createElement('textarea'); decoder.innerHTML = content; content = decoder.value;
  }
  const text = new DOMParser().parseFromString(content, 'text/html').body.textContent?.trim() || '';
  return { title: 'Mercury article', summary: `${result.title || 'Article'} · ${result.word_count || 0} words · Postlight Parser 2.2.3`, sections: [
    { type: 'article', plugin: 'mercury', title: result.title || 'Article', html: preserveArticleImageDimensions(content, html, url) },
    { type: 'json', title: 'Article metadata', data: metadata },
    { type: 'text', title: 'Article text', text },
  ] };
}
