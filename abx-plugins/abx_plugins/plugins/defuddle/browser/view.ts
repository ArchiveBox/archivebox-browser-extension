import { preserveArticleImageDimensions } from '@/src/archive/article';
import Defuddle from 'defuddle';
import type { ViewContext, ViewResult } from '@/src/archive/views';

export default async function({ archive, url }: ViewContext): Promise<ViewResult> {
  const doc = (await archive.dom()).cloneNode(true) as Document;
  const source = doc.documentElement.outerHTML;
  const result = new Defuddle(doc, { url, useAsync: false }).parse();
  const { content, ...metadata } = result;
  if (!content?.trim()) return { title: 'Defuddle', summary: 'No article content found in the archived DOM', sections: [{ type: 'json', title: 'Metadata', data: metadata }] };
  return { title: 'Defuddle', summary: `${result.title || 'Article'} · ${result.wordCount} words`, sections: [
    { type: 'article', plugin: 'defuddle', title: result.title || 'Article', html: preserveArticleImageDimensions(content, source, url) },
    { type: 'json', title: 'Article metadata', data: metadata },
  ] };
}
