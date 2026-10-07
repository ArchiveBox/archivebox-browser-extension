import type {ArchiveReader} from '../archive/reader';
import type {Capture} from '../capture/types';
import type {CardModule} from '../archive/cards';
import {cardTemplate} from './presentation';
import {mountReplay,replayURL} from '../archive/replay';
const modules=import.meta.glob('../../abx-plugins/abx_plugins/plugins/*/browser/card.ts');

/** Card hooks render bounded summaries. They never mount full plugin viewers. */
export function mountCardPreviews(container:HTMLElement,{archive,capture,resources}:{archive:ArchiveReader;capture:Capture;resources:Map<string,()=>void>}){
 let disposed=false;const controller=new AbortController(),previews=new Map<string,Promise<string>>();
 const start=async(frame:HTMLIFrameElement)=>{
  const name=frame.dataset.pluginPreview!,url=capture.finalUrl||capture.url;
  frame.sandbox.add('allow-same-origin');
  if(name==='archivewebpage'){
   const page=archive.documentEntry();await mountReplay(archive);if(!disposed)frame.src=replayURL(archive,page?.url||url,page?.timestamp);return;
  }
  let preview=previews.get(name);
  if(!preview){
   const load=modules[`../../abx-plugins/abx_plugins/plugins/${name}/browser/card.ts`];
   if(!load)throw Error(`Missing card hook: ${name}`);
   preview=load().then(module=>(module as CardModule).default({archive,capture,url,signal:controller.signal}));previews.set(name,preview);
  }
  const html=await preview;if(disposed)return;
  const template=cardTemplate(name)||'';
  if(template.includes('<iframe src="{{ output_path }}?preview=1&amp;titlebar=0"')){
   const outer=new DOMParser().parseFromString(template,'text/html'),inner=outer.querySelector('iframe')!;
   inner.removeAttribute('src');inner.removeAttribute('loading');inner.sandbox.value='allow-same-origin';inner.srcdoc=html;
   frame.srcdoc='<!doctype html>'+outer.documentElement.outerHTML;
  }else frame.srcdoc=html;
 };
 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){
  observer.unobserve(entry.target);const plugin=(entry.target as HTMLElement).dataset.resourcePreview;
  if(plugin){const render=resources.get(plugin);resources.delete(plugin);render?.()}
  else void start(entry.target as HTMLIFrameElement).catch(error=>{if(!disposed){const doc=document.implementation.createHTMLDocument();doc.body.textContent=String(error);(entry.target as HTMLIFrameElement).srcdoc=doc.documentElement.outerHTML}});
 }},{rootMargin:'100px'});
 container.querySelectorAll<HTMLIFrameElement>('iframe[data-plugin-preview]').forEach(frame=>observer.observe(frame));
 container.querySelectorAll<HTMLElement>('[data-resource-preview]').forEach(preview=>observer.observe(preview));
 return()=>{disposed=true;controller.abort();observer.disconnect()};
}
