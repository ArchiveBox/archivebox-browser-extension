import type {ArchiveReader} from './reader';
import type {ViewContext,ViewResult} from './views';
import {recordURL} from './replay';

/** Cards consume capture evidence independently of full-view derivations. */
export type CardModule={default:(context:ViewContext)=>Promise<string>};
const documents=new WeakMap<ArchiveReader,Promise<Document>>();
/** Shared, inert, read-only source for summaries. Never mutate this document. */
export function cardDOM(archive:ArchiveReader){
 let pending=documents.get(archive);
 if(!pending){pending=archive.sourceDOM();documents.set(archive,pending);pending.catch(()=>documents.delete(archive))}
 return pending;
}
export function cardDocument(template:string){
 const doc=new DOMParser().parseFromString(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),'text/html');
 doc.querySelectorAll('header,nav').forEach(node=>node.remove());
 doc.documentElement.style.overflow='hidden';doc.body.style.overflow='hidden';
 return doc;
}
export const cardHTML=(doc:Document)=>'<!doctype html>'+doc.documentElement.outerHTML;
export function cardElement(doc:Document,tag:string,text:unknown='',className=''){
 const node=doc.createElement(tag);node.textContent=String(text??'');node.className=className;return node;
}
/** Reuse the canonical renderer in preview mode, without mounting a full viewer.
 * Preview data loaders and renderers bound their work; the card retains the
 * original template, classes and layout instead of substituting generic markup. */
export async function canonicalCard(view:(context:ViewContext)=>Promise<ViewResult>,context:ViewContext){
 const result=await view({...context,preview:true}),presentation=result.presentation;
 if(presentation?.type!=='canonical')throw Error('Card requires a canonical presentation');
 context.signal?.throwIfAborted();
 const doc=cardDocument(presentation.template);
 const cleanup=await presentation.initialize(doc,presentation.data,{preview:true,downloadURL:'',rawURL:'',openFiles:()=>{},resourceURL:(value,base)=>{
  if(!value)return undefined;try{const entry=context.archive.find(new URL(value,base||context.url).href);return entry?recordURL(context.archive,entry):undefined}catch{return undefined}
 }});
 try{return cardHTML(doc)}finally{cleanup?.()}
}
export function hookSummary(context:ViewContext,plugin:string){return context.capture?.hooks.filter(hook=>hook.plugin===plugin).map(hook=>hook.summary||'').join('; ')||''}
