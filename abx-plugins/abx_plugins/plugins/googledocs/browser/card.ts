import type {ViewContext} from '@/src/archive/views';
import {cardDocument,cardHTML,cardElement} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/googledocs/card.html?raw';
import {exportEvidence} from './model';
export default async function(context:ViewContext){
  const data=exportEvidence(context),doc=cardDocument(template);
  doc.getElementById('title')!.textContent=data?.title||'Google Docs exports';
  for(const format of new Set(data?.exports.map(item=>item.format)||[]))doc.getElementById('formats')!.append(cardElement(doc,'span',format.toUpperCase(),'badge'));
  return cardHTML(doc);
}
