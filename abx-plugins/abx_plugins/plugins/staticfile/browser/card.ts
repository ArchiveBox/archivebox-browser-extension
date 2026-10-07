import type {ViewContext} from '@/src/archive/views';
import {cardHTML} from '@/src/archive/cards';
import {recordURL} from '@/src/archive/replay';
import template from '@/vendor/archivebox/plugins/staticfile/card.html?raw';
import {originalFile} from './source';
export default async function(context:ViewContext){
 const source=await originalFile(context);if(!source)throw Error('Original file unavailable');
 const doc=new DOMParser().parseFromString(template,'text/html'),wrapper=doc.querySelector('.staticfile-thumbnail')!;
 const tag=source.entry.mime==='application/pdf'?'embed':source.entry.mime.startsWith('image/')?'img':source.entry.mime.startsWith('video/')?'video':'iframe';
 const resource=wrapper.querySelector(tag)!;resource.setAttribute('src',recordURL(context.archive,source.entry)+(tag==='embed'?'#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH':''));
 wrapper.replaceChildren(resource);doc.body.replaceChildren(wrapper);doc.documentElement.style.cssText='height:100%;margin:0;overflow:hidden';doc.body.style.cssText='height:100%;margin:0;overflow:hidden';
 return cardHTML(doc);
}
