import type {ViewContext,ViewResult} from '@/src/archive/views';
import {replayHTML,originalURL} from '@/src/archive/replay';
import {playerURL} from '@/src/replay/client';
import {getPageData} from 'single-file-core/single-file.js';

// SingleFile's supported transport adapter can only read our replay origin.
// The engine never falls through to a live original URL.
function replayFetch(url:string,options?:RequestInit){
 if(!url.startsWith(playerURL('w/'))&&!url.startsWith(playerURL('plugin-record/'))&&!url.startsWith('data:'))throw Error('SingleFile requested a resource outside WACZ replay: '+url);
 return fetch(url,{...options,cache:'force-cache'});
}
export default async function({archive,url,signal}:ViewContext):Promise<ViewResult>{
 const started=performance.now();performance.mark('archivebox:singlefile:start');
 const rendered=await archive.dom();
 signal?.throwIfAborted();
 const html=await replayHTML(archive,'<!doctype html>'+rendered.documentElement.outerHTML,url);
 signal?.throwIfAborted();
 const frame=document.createElement('iframe');frame.sandbox.add('allow-same-origin');frame.setAttribute('aria-hidden','true');
 frame.style.cssText='position:fixed;left:-20000px;top:0;width:1440px;height:1000px;border:0;pointer-events:none';
 const policy="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' data: blob:";
 try{
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{frame.onload=null;signal?.removeEventListener('abort',abort)};
   const abort=()=>{cleanup();reject(signal?.reason)};
   frame.onload=()=>{cleanup();resolve()};signal?.addEventListener('abort',abort,{once:true});
   frame.srcdoc=html.replace(/<head([^>]*)>/i,`<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`);document.body.append(frame);
  });
  signal?.throwIfAborted();
  const doc=frame.contentDocument!,win=frame.contentWindow!;
  for(const link of doc.querySelectorAll<HTMLAnchorElement>('a[href],link[rel="canonical"]'))link.href=originalURL(archive,link.href);
  for(const image of doc.images)image.loading='eager';
  await Promise.all([...doc.images].map(image=>image.decode().catch(()=>{})));await doc.fonts.ready;
  const result=await getPageData({url,removeScripts:true,removeFrames:true,loadDeferredContent:false,
   removeHiddenElements:false,removeUnusedStyles:false,removeUnusedFonts:false,
   removeImports:true,compressHTML:true,groupDuplicateImages:true,
   removeAlternativeFonts:false,removeAlternativeMedias:false,removeAlternativeImages:false,
   insertSingleFileComment:true,insertCanonicalLink:true,filenameTemplate:'singlefile.html',
   onprogress:()=>signal?.throwIfAborted(),
  },{fetch:replayFetch},doc,win);
  signal?.throwIfAborted();
  performance.measure('archivebox:singlefile:generate',{start:started});
  return {title:'SingleFile',summary:'',sections:[{type:'html',title:'SingleFile',html:result.content}]};
 }finally{frame.remove()}
}
