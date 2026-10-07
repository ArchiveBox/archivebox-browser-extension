import type {ViewContext} from '@/src/archive/views';
import {cardDocument,cardHTML,cardElement} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/title/full.html?raw';
export default async function({capture,archive}:ViewContext){const doc=cardDocument(template);doc.getElementById('content')!.append(cardElement(doc,'h1',capture?.title||archive.pages.at(-1)?.title||'','page-title'));return cardHTML(doc)}
