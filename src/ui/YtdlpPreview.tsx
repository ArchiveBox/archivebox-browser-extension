import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import type {YtdlpPresentation,YtdlpFile} from '../../abx-plugins/abx_plugins/plugins/ytdlp/browser/view';
import {capturedMedia} from '../../abx-plugins/abx_plugins/plugins/ytdlp/browser/view';
import {mountReplay,recordURL} from '../archive/replay';
import {initializeYtdlp,type RenderedMediaFile} from './ytdlp-template';
import {attachArchivedStream} from './StreamPreview';
import {pluginIcon} from './presentation';
import fullTemplate from '../../vendor/archivebox/plugins/ytdlp/full.html?raw';
import cardTemplate from '../../vendor/archivebox/plugins/ytdlp/card.html?raw';
const markup=fullTemplate.replace(/<script>[\s\S]*?<\/script>/,'').replace('{{ plugin_icon }}',pluginIcon('ytdlp'));
export function YtdlpPreview({archive,presentation}:{archive:ArchiveReader;presentation:YtdlpPresentation}){
 const frame=React.useRef<HTMLIFrameElement>(null),[doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
 React.useEffect(()=>{if(!doc?.getElementById('stage'))return;let current=true,cleanup:(()=>void)|undefined;const blobs:string[]=[];const controller=new AbortController();
  void(async()=>{await mountReplay(archive);if(!current)return;
   const files:RenderedMediaFile[]=presentation.files.map((file,index)=>{let url:string;if(file.entry)url=recordURL(archive,file.entry);else if(file.assembly)url='#media-'+index;else{url=URL.createObjectURL(new Blob([file.content||''],{type:file.mime+';charset=utf-8'}));blobs.push(url)}return {...file,url}});
   const assembled=new Map<RenderedMediaFile,Promise<Blob>>();
   const resolve=async(file:RenderedMediaFile,onProgress:(message:string)=>void)=>{
    if(!file.assembly)return file.url;
    let pending=assembled.get(file);
    if(!pending){pending=import('../../vendor/yt-dlp/ffmpeg').then(({assembleArchivedMedia})=>assembleArchivedMedia(archive,file.assembly!,controller.signal,onProgress)).then(blob=>{controller.signal.throwIfAborted();file.size=blob.size;file.url=URL.createObjectURL(blob);blobs.push(file.url);return blob});assembled.set(file,pending)}
    await pending;return file.url;
   };
   const dispose=await initializeYtdlp(doc,files,{resolve,files:()=>{location.hash='view=ytdlp&files=1'},read:async file=>file.content??(file.entry?await archive.text(file.entry):''),stream:async(video,file,onError)=>file.entry&&file.stream?await attachArchivedStream(video,archive,file.entry,file.stream,onError):()=>{},download:url=>{
    const file=files.find(file=>file.url===url);if(!file)return;
    void(async()=>{const body=file.assembly?await assembled.get(file):file.entry?(await archive.read(file.entry)).body:file.content||'';const href=URL.createObjectURL(new Blob([body as BlobPart],{type:file.mime}));const link=document.createElement('a');link.href=href;link.download=file.path.split('/').at(-1)||'media';link.click();setTimeout(()=>URL.revokeObjectURL(href),60000)})().catch(e=>{if(current)setError(String(e))});
   }});if(current)cleanup=dispose;else dispose();
  })().catch(e=>{if(current)setError(String(e))});
  return()=>{current=false;controller.abort();cleanup?.();blobs.forEach(url=>URL.revokeObjectURL(url))};
 },[archive,presentation,doc]);
 return <>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title="Archived media" className="document-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" srcDoc={markup} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}
/** Canonical file badges require only the index; never start Python for a card. */
export function createYtdlpCardPreview({archive}:{archive:ArchiveReader}){
 const files:YtdlpFile[]=capturedMedia(archive).map(entry=>({entry,path:decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1)||entry.url),mime:entry.mime}));
 const wrapper=document.createElement('div');const style=document.createElement('style');style.textContent=cardTemplate.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';wrapper.append(style);
 const list=document.createElement('div');list.className='ytdlp-file-list';wrapper.append(list);
 if(!files.length){const empty=document.createElement('p');empty.setAttribute('style','margin:0 0 6px;color:#666;font:12px/1.4 system-ui,sans-serif');empty.textContent='No video or audio identified. Saved files:';list.append(empty);
  const plugin=archive.metadata?.plugins.find((plugin:any)=>plugin.id==='ytdlp');for(const track of (plugin?.hooks[0]?.data as {tracks?:{ref?:{url:string;ts:number}}[]}|undefined)?.tracks||[]){const entry=track.ref&&archive.find(track.ref.url,track.ref.ts);if(entry)files.push({entry,path:new URL(entry.url).pathname.split('/').at(-1)||entry.url,mime:entry.mime})}
 }
 for(const file of files){const badge=document.createElement('div');badge.className='ytdlp-file-badge';badge.title=file.path;const icon=document.createElement('span');icon.className='ytdlp-file-icon';icon.setAttribute('aria-hidden','true');icon.textContent=file.mime.startsWith('video/')?'🎬':file.mime.startsWith('audio/')?'🎧':'📄';const name=document.createElement('span');name.className='ytdlp-file-name';name.textContent=file.path;badge.append(icon,name);list.append(badge)}
 return wrapper;
}
