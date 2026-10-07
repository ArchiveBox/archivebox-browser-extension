import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';

export default async function({ archive }: ViewContext): Promise<ViewResult> {
  const doc = await archive.dom();
  const candidates = [
    ['Document title', doc.title.trim()],
    ['Open Graph', doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || ''],
    ['Twitter', doc.querySelector('meta[name="twitter:title"],meta[property="twitter:title"]')?.getAttribute('content')?.trim() || ''],
    ['First heading', doc.querySelector('h1')?.textContent?.trim() || ''],
  ].filter(([, value]) => value);
  const title = candidates[0]?.[1];
  return {
    title: 'Title', summary: title || 'No title found in the archived document',
    sections: [], presentation:textPresentation('title',title||'','title'),
  };
}
