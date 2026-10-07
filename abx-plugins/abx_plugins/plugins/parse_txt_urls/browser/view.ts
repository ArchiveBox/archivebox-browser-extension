import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';
import { sourceEntries, textURLs } from './urls';
export default async function({ archive, url, preview }: ViewContext): Promise<ViewResult> {
  const entries = sourceEntries(archive, url, (mime, source) => /^text\/(?:plain|markdown)/i.test(mime) || /\.(?:txt|md)(?:[?#]|$)/i.test(source), preview?3:undefined);
  const rows: (string | number | boolean)[][] = []; const unique = new Set<string>();
  for (const entry of entries) (await archive.text(entry)).split(/\r?\n/).forEach((line, index) => {
    for (const target of new Set(textURLs(line))) { if (target === entry.url) continue; unique.add(target); rows.push([target, entry.url, index + 1, Boolean(archive.find(target))]); }
  });
  const data=rows.map(([url,source_url,line])=>JSON.stringify({url,source_url,line})).join('\n');
  return { title: 'Text URLs', summary: `${unique.size} unique HTTP URLs`, sections: [],presentation:textPresentation('parse_txt_urls',data,'urls') };
}
