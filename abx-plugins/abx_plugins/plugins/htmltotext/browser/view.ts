import type { ViewContext, ViewResult } from '@/src/archive/views';
import {textPresentation} from '@/src/ui/canonical-text';

export default async function({ archive }: ViewContext): Promise<ViewResult> {
  const doc = (await archive.dom()).cloneNode(true) as Document;
  doc.querySelectorAll('script,style,noscript,template,[hidden],[aria-hidden="true"]').forEach(el => el.remove());
  const blocks = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL']);
  function text(node: Node, preserve = false): string {
    if (node.nodeType === Node.TEXT_NODE) return preserve ? node.textContent || '' : (node.textContent || '').replace(/\s+/g, ' ');
    if (!(node instanceof Element)) return [...node.childNodes].map(child => text(child, preserve)).join('');
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    const content = [...node.childNodes].map(child => text(child, preserve || node.tagName === 'PRE')).join('');
    if (node.tagName === 'TD' || node.tagName === 'TH') return content + '\t';
    return blocks.has(node.tagName) ? `\n${node.tagName === 'LI' ? '• ' : ''}${content}\n` : content;
  }
  const output = text(doc.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const words = output.match(/\S+/g)?.length || 0;
  return { title: 'HTML to Text', summary: output ? `${words} words · ${output.length} characters` : 'No document text found', sections:[],presentation:textPresentation('htmltotext',output,'text') };
}
