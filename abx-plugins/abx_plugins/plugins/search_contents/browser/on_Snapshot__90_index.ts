import MiniSearch from 'minisearch';
import {sha256} from 'hash-wasm';
import type {HookContext,HookResult,RecordRef} from '@/src/capture/types';
import {openZipMembers} from '@/src/archive/zip-members';
import {originalText,textFormat} from './text';
import {searchOptions,type SearchDocument,type SearchIndex} from './index';

export default async function(ctx:HookContext):Promise<HookResult>{
 const index=new MiniSearch(searchOptions),documents:SearchDocument[]=[],seen=new Set<string>(),errors:string[]=[];
 async function add(body:Uint8Array,mime:string,name:string,ref:RecordRef,digest?:string){
  ctx.signal.throwIfAborted();
  const key=digest||await sha256(body);if(seen.has(key))return;seen.add(key);
  if(textFormat(mime,name)){
   const content=await originalText(body,mime,name);if(!content.text.trim())return;
   const document={id:documents.length,url:ref.url,title:content.title||name,mime,ref};
   index.add({...document,text:content.text});documents.push(document);
  }else if(/(?:zip|x-zip-compressed)/i.test(mime)||/\.zip$/i.test(name)){
   const zip=await openZipMembers(body,ctx.signal);
   try{for(const member of zip.members){
    if(textFormat(member.mime,member.path)||/\.zip$/i.test(member.path))await add(await member.read(),member.mime,member.path,{...ref,member:[...ref.member||[],member.path]});
   }}finally{await zip.close()}
  }
 }
 for(const entry of await ctx.archive.entries()){
  ctx.signal.throwIfAborted();
  try{
   if(entry.url.startsWith('urn:ocr:')){
    const result=await ctx.archive.read(entry),parsed=JSON.parse(new TextDecoder().decode(result.body)),source=result.metadata.document as {source:RecordRef;name:string;mime:string};
    if(!parsed.text?.trim())continue;
    const document={id:documents.length,url:source.source.url,title:source.name,mime:source.mime,ref:source.source,ocr:{url:entry.url,ts:entry.ts,captureId:ctx.captureId}};
    index.add({...document,text:parsed.text});documents.push(document);
   }else if(/^https?:/.test(entry.url)&&entry.method!=='HEAD'&&entry.status>=200&&entry.status<300&&entry.status!==206){
    if(!textFormat(entry.mime,entry.url)&&!/(?:zip|octet-stream)/i.test(entry.mime))continue;
    const response=await ctx.archive.read(entry),disposition=response.headers['content-disposition']||'';
    let name=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]||/filename="([^"]+)"|filename=([^;]+)/i.exec(disposition)?.slice(1).find(Boolean)||entry.url;
    try{name=decodeURIComponent(name)}catch{/* Retain a literal original filename with malformed escaping. */}
    await add(response.body,response.mime,name,{url:entry.url,ts:entry.ts,captureId:ctx.captureId},entry.digest);
   }
  }catch(error){ctx.signal.throwIfAborted();const message=`${entry.url}: ${String(error)}`;ctx.log(message);errors.push(message)}
 }
 const payload:SearchIndex={version:1,engine:'MiniSearch 7.2.0',documents,index:index.toJSON()};
 const ref=await ctx.archive.addResource({kind:'index',mime:'application/json',body:JSON.stringify(payload),metadata:{documents:documents.length,types:[...new Set(documents.map(document=>document.mime))]}});
 return {status:errors.length?'failed':documents.length?'succeeded':'noresults',records:[ref],summary:`${documents.length} indexed documents${errors.length?`; ${errors.length} unreadable resources`:''}`};
}
