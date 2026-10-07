import type { ViewContext, ViewResult } from '@/src/archive/views';
export default async function({ archive }: ViewContext): Promise<ViewResult> {
  const document=await archive.dom(),html='<!doctype html>'+document.documentElement.outerHTML;
  return { title: 'Rendered DOM', summary: 'Rendered page', sections: [
    { type: 'html', title: 'Offline preview', html },
    { type: 'text', title: 'HTML source', text: html },
  ] };
}
