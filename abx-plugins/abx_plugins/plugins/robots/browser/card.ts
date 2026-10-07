import type {ViewContext} from '@/src/archive/views';
import {cardDocument,cardHTML} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/htmltotext/full.html?raw';
export default async function({archive,url}:ViewContext){const entry=archive.find(new URL('/robots.txt',url).href),doc=cardDocument(template);doc.getElementById('article')!.textContent=entry?(await archive.text(entry)).slice(0,2400):'';return cardHTML(doc)}
