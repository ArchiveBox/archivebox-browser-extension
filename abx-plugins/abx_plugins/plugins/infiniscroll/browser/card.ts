import type {ViewContext} from '@/src/archive/views';
import {cardDocument,cardHTML} from '@/src/archive/cards';
import template from './infiniscroll.html?raw';
import {renderScroll,type ScrollEvidence} from './presentation';
export default async function({archive,url}:ViewContext){
 const entry=archive.artifact('infiniscroll'),data:ScrollEvidence|null=entry?await archive.json(entry):null,doc=cardDocument(template);
 // The miniature diagram uses recorded geometry without decoding full-page
 // images or constructing controls, downloads, and metadata scans.
 renderScroll(doc,data,data?.frames||[],[],url,{downloadURL:'',rawURL:'',openFiles(){},resourceURL:()=>undefined});
 doc.querySelectorAll('.detail,.controls,.frame-list').forEach(node=>node.remove());
 const workspace=doc.querySelector<HTMLElement>('.workspace');if(workspace)workspace.style.gridTemplateColumns='1fr';
 return cardHTML(doc);
}
