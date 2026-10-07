import { preserveArticleImageDimensions, renderReadabilityDocument } from '@/src/archive/article';
import { Readability } from '@mozilla/readability';
import type { ViewContext, ViewResult } from '@/src/archive/views';

export default async function({ archive, url }: ViewContext): Promise<ViewResult> {
  const doc = (await archive.dom()).cloneNode(true) as Document;
  const base = doc.querySelector('base') || doc.head.appendChild(doc.createElement('base'));
  try { base.setAttribute('href', new URL(base.getAttribute('href') || url, url).href); }
  catch { base.setAttribute('href', url); }
  const source = doc.documentElement.outerHTML;
  const result = new Readability(doc).parse();
  if (!result?.content) return { title: 'Readability', summary: 'No readable article found in the archived DOM', sections: [] };
  const { content, textContent, ...metadata } = result;
  return { title: 'Readability', summary: `${result.title || 'Article'} · ${textContent?.length || 0} characters`, sections: [
    { type: 'article', plugin: 'readability', title: result.title || 'Article', html: renderReadabilityDocument(preserveArticleImageDimensions(content, source, url), metadata, url, archive) },
    { type: 'json', title: 'Article metadata', data: metadata },
    { type: 'text', title: 'Article text', text: textContent || '' },
  ] };
}
