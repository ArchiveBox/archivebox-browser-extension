import type {ViewContext,ViewResult} from '@/src/archive/views';
import type {ArchiveReader,ArchiveEntry} from '@/src/archive/reader';
import type {GalleryResult} from '../../../../../vendor/gallery-dl/runtime';
import {runExtractorWorker} from '../../../../../vendor/python/worker-client';
import {createArchivedTransport} from '../../../../../vendor/python/transport';
export type GalleryImage={entry:ArchiveEntry;name:string;size:number};
export type GalleryPresentation={type:'gallery';images:GalleryImage[];messages:GalleryResult['messages'];errors:string[];logs:string[]};
type Context=ViewContext&{signal?:AbortSignal};
type Pending={promise:Promise<ViewResult>;controller:AbortController;consumers:Set<symbol>;complete:boolean};
const results=new WeakMap<ArchiveReader,Pending>();
export default function(context:Context):Promise<ViewResult>{
  context.signal?.throwIfAborted();
  let result=results.get(context.archive);
  if(!result){
    const controller=new AbortController();
    result={controller,consumers:new Set(),complete:false,promise:undefined!};const current=result;
    result.promise=derive({...context,signal:controller.signal}).then(view=>{current.complete=true;return view},error=>{if(results.get(context.archive)===current)results.delete(context.archive);throw error});
    results.set(context.archive,result);
  }
  const current=result,consumer=Symbol();current.consumers.add(consumer);
  return new Promise((resolve,reject)=>{
    const release=()=>{context.signal?.removeEventListener('abort',abort);current.consumers.delete(consumer);if(!current.consumers.size&&!current.complete){current.controller.abort();if(results.get(context.archive)===current)results.delete(context.archive)}};
    const abort=()=>{release();reject(context.signal?.reason||new DOMException('Aborted','AbortError'))};
    context.signal?.addEventListener('abort',abort,{once:true});
    current.promise.then(view=>{release();if(!context.signal?.aborted)resolve(view)},error=>{release();if(!context.signal?.aborted)reject(error)});
  });
}
async function derive({archive,url,capture,signal}:Context):Promise<ViewResult>{
  const config=JSON.parse(String(capture?.pluginConfig?.gallerydl?.GALLERYDL_CONFIG || '{}'));const logs:string[]=[];
  const refs=capture?.hooks.filter(hook=>hook.plugin==='gallerydl').flatMap(hook=>hook.records||[])||[];
  const request=await createArchivedTransport(archive,refs);
  signal?.throwIfAborted();
  const result=await runExtractorWorker<GalleryResult>('gallery',[url,config,false],{request,log:message=>logs.push(message),sleep:async()=>{}},signal);
  result.errors.push(...request.failures);
  if(!result.supported)return {title:'Gallery',summary:'No captured images',sections:[],presentation:{type:'gallery',images:[],messages:[],errors:[],logs}};
  const originals=new Map<string,typeof archive.entries[number]>();
  for(const ref of refs){const entry=archive.find(ref.url,ref.ts);if(!entry)continue;const headers=await archive.headers(entry);const metadata=JSON.parse(headers.warcHeaders['WARC-JSON-Metadata']||'{}');originals.set(entry.url,entry);if(metadata.requestedUrl)originals.set(metadata.requestedUrl,entry);}
  const entryFor=(target:string)=>originals.get(target)||archive.find(target);
  const files=result.messages.filter(message=>message.type==='url');const available=files.filter(message=>{const entry=entryFor(message.url);return entry && entry.status>=200&&entry.status<300;});
  const images:GalleryImage[]=[];
  const seen=new Set<string>();
  for(const message of available){
    const entry=entryFor(message.url)!;
    if(seen.has(entry.url)||(!entry.mime.startsWith('image/')&&!/\.(avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#]|$)/i.test(message.url)))continue;
    seen.add(entry.url);
    const {headers}=await archive.headers(entry);
    const size=headers['content-length']&&!headers['content-encoding']&&/^\d+$/.test(headers['content-length'])?Number(headers['content-length']):Number(message.metadata.filesize||message.metadata.size)||0;
    const basename=decodeURIComponent(new URL(message.url).pathname.split('/').pop()||'Image');
    const filename=String(message.metadata.filename||basename),extension=String(message.metadata.extension||'');
    images.push({entry,name:extension&&!filename.toLowerCase().endsWith('.'+extension.toLowerCase())?filename+'.'+extension:filename,size});
  }
  const missing=files.filter(message=>!available.includes(message)).map(message=>'Missing captured image: '+message.url);
  return {title:'Gallery',summary:`${images.length} images`,sections:[],presentation:{type:'gallery',images,messages:result.messages,errors:[...result.errors,...missing],logs}};
}
