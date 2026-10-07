import type {ViewContext} from '@/src/archive/views';
import {cardDOM,cardDocument,cardHTML} from '@/src/archive/cards';
import {recordURL} from '@/src/archive/replay';
import {initializeSEO} from '@/src/ui/seo-template';
import template from '@/vendor/archivebox/plugins/seo/full.html?raw';
export default async function({archive,capture,url}:ViewContext){
 const source=await cardDOM(archive),doc=cardDocument(template),data:Record<string,string>={url,title:source.title,language:source.documentElement.lang};
 for(const tag of source.querySelectorAll('meta')){const key=tag.getAttribute('name')||tag.getAttribute('property'),value=tag.getAttribute('content');if(key&&value)data[key]=value}
 const favicon=capture?.hooks.find(hook=>hook.plugin==='favicon')?.records?.map(ref=>archive.find(ref.url,ref.ts)).find(entry=>entry?.mime.startsWith('image/'));
 initializeSEO(doc,data,{downloadURL:'',rawURL:'',openFiles(){},resourceURL:value=>{const entry=value&&archive.find(new URL(value,url).href);return entry?recordURL(archive,entry):undefined}},favicon?.url);
 doc.querySelector('.metadata')?.remove();return cardHTML(doc);
}
