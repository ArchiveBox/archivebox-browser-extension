import type {ArchiveReader} from './reader';
import {createReplay} from './replay-frame';
import {playerURL} from '../replay/client';

const rendered=new WeakMap<ArchiveReader,Promise<string>>();
/** A disposable view-time DOM, never a second captured HTML file. */
export async function renderedDOM(archive:ArchiveReader):Promise<Document>{
 let pending=rendered.get(archive);
 if(!pending){pending=render(archive);rendered.set(archive,pending);pending.catch(()=>rendered.delete(archive))}
 return new DOMParser().parseFromString(await pending,'text/html');
}
async function render(archive:ArchiveReader){
 const entry=archive.documentEntry();if(!entry)throw Error('This capture has no HTML document');
 const replay=await createReplay(archive,entry.url,entry.timestamp);
 replay.style.cssText='position:fixed;left:-20000px;top:0;width:1440px;height:1000px;pointer-events:none';
 replay.setAttribute('aria-hidden','true');
 try{
  document.body.append(replay);await replay.updateComplete;
  const frame=replay.shadowRoot?.querySelector('iframe');if(!frame)throw Error('ReplayWeb.page did not create its document frame');
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);frame.removeEventListener('load',loaded)};
   const loaded=()=>{if(frame.contentDocument?.URL==='about:blank')return;cleanup();resolve()};
   const timer=setTimeout(()=>{cleanup();reject(Error('Archived document did not finish loading'))},30000);
   frame.addEventListener('load',loaded);
   if(frame.contentDocument?.readyState==='complete'&&frame.contentDocument.URL!=='about:blank')loaded();
  });
  const doc=frame.contentDocument;if(!doc?.documentElement)throw Error('Replay DOM is unavailable');
  if(replay.replayNotFoundError)throw Error('The archived document was not found');
  await doc.fonts.ready;
  const originalImages=doc.querySelectorAll<HTMLImageElement>('img');
  for(const image of originalImages)image.loading='eager';
  await Promise.all([...originalImages].map(image=>image.decode().catch(()=>{})));
  const clone=doc.documentElement.cloneNode(true) as HTMLElement;
  // Port the existing DOM plugin's image/SVG sizing, now after offline replay.
  const originals=doc.querySelectorAll<HTMLElement|SVGElement>('img,svg');
  clone.querySelectorAll<HTMLElement|SVGElement>('img,svg').forEach((image,index)=>{
   const style=getComputedStyle(originals[index]!);
   if(parseFloat(style.width)>0&&parseFloat(style.height)>0){image.style.width=style.width;image.style.height=style.height;if(image.tagName.toLowerCase()==='svg'){image.setAttribute('width',style.width);image.setAttribute('height',style.height)}}
  });
  const base=clone.querySelector('base')||doc.createElement('base');base.setAttribute('href',entry.url);clone.querySelector('head')!.prepend(base);
  const prefix=playerURL(`w/${archive.captureId}/`).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Return original resource addresses to parsers; each displayed view rewrites
  // those addresses through the same collection, including CSS and srcset URLs.
  return ('<!doctype html>'+clone.outerHTML).replace(new RegExp(prefix+'(?::[a-f0-9]+/)?\\d*[a-z]+_/','g'),'');
 }finally{replay.clearHilite(true);replay.remove()}
}
