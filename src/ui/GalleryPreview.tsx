import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import type {Capture} from '../capture/types';
import type {GalleryPresentation} from '../../abx-plugins/abx_plugins/plugins/gallerydl/browser/view';
import {mountReplay,recordURL} from '../archive/replay';
import {pluginIcon} from './presentation';
import {initializeGallery} from './gallery-template';
import fullTemplate from '../../vendor/archivebox/plugins/gallerydl/full.html?raw';
import cardTemplate from '../../vendor/archivebox/plugins/gallerydl/card.html?raw';

// Original markup/CSS, with its inline script compiled in gallery-template.ts.
const markup=fullTemplate.replace(/<script>[\s\S]*?<\/script>/,'').replace('{{ plugin_icon }}',pluginIcon('gallerydl'));
export function GalleryPreview({archive,presentation}:{archive:ArchiveReader;presentation:GalleryPresentation}){
  const frame=React.useRef<HTMLIFrameElement>(null);
  const [doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
  React.useEffect(()=>{
    if(!doc?.getElementById('gallery'))return;let current=true;
    void mountReplay(archive).then(()=>{
      if(!current)return;
      initializeGallery(doc,presentation.images.map(image=>({url:recordURL(archive,image.entry),name:image.name,size:image.size})),()=>{location.hash='view=gallerydl&files=1'},url=>{
        // Chromium downloads bypass the replay service worker. Resolve the
        // original record on click, as ResourcePreview does, without saving a
        // second copy in the archive or changing the canonical controls.
        const image=presentation.images.find(image=>recordURL(archive,image.entry)===url);if(!image)return;
        void archive.read(image.entry).then(record=>{const blob=URL.createObjectURL(new Blob([record.body as BlobPart],{type:image.entry.mime}));const link=document.createElement('a');link.href=blob;link.download=image.name;link.click();setTimeout(()=>URL.revokeObjectURL(blob),60000)}).catch(error=>{if(current)setError(String(error))});
      });
    }).catch(error=>{if(current)setError(String(error))});
    return()=>{current=false};
  },[archive,presentation,doc]);
  return <>{error&&<p role="alert">{error}</p>}{presentation.errors.length>0&&<p role="alert">{presentation.errors.join('\n')}</p>}<iframe ref={frame} title="Image gallery" className="document-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" srcDoc={markup} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}

/** The unchanged card's first-image markup is shared with stack-cover clones. */
export async function createGalleryCardPreview({archive,capture,signal}:{archive:ArchiveReader;capture:Capture;signal?:AbortSignal}){
  // The capture hook already identifies acquired originals. A cover needs only
  // the first image; native metadata extraction belongs to the selected view.
  const source=capture.hooks.filter(hook=>hook.plugin==='gallerydl').flatMap(hook=>hook.records||[]).map(ref=>archive.find(ref.url,ref.ts)).find(entry=>entry?.method!=='HEAD'&&entry?.mime.startsWith('image/')&&entry.status>=200&&entry.status<300);
  await mountReplay(archive);signal?.throwIfAborted();
  const template=document.createElement('template');template.innerHTML=cardTemplate;
  const card=template.content.firstElementChild as HTMLElement;
  const image=card.querySelector('img')!;image.removeAttribute('onerror');
  if(source){image.src=recordURL(archive,source);image.alt=decodeURIComponent(new URL(source.url).pathname.split('/').pop()||'Image');image.loading='lazy';image.decoding='async';}
  else{image.removeAttribute('src');image.style.display='none';(image.nextElementSibling as HTMLElement).style.display='flex';}
  return card;
}
