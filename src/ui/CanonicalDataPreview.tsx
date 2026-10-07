import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import type {CanonicalPresentation} from '../archive/views';
import {mountReplay,recordURL} from '../archive/replay';
import {pluginIcon} from './presentation';

/** Original plugin document and compiled original initializer. Only source-file
 * lookup and output links are supplied by this WACZ host. */
export function CanonicalDataPreview({archive,presentation,hideTitlebar=false}:{archive:ArchiveReader;presentation:CanonicalPresentation;hideTitlebar?:boolean}){
  const frame=React.useRef<HTMLIFrameElement>(null),[doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
  const markup=React.useMemo(()=>{
    const html=presentation.template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replaceAll('{{ plugin_icon }}',pluginIcon(presentation.plugin));
    // Fragment templates (e.g. screenshot) normally inherit the snapshot's
    // zero-margin body. Supply that same shell inside their isolated frame.
    return /<html\b/i.test(html)?html:`<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${html}</body></html>`;
  },[presentation.template,presentation.plugin]);
  React.useEffect(()=>{
    if(!doc)return;let current=true,cleanup:void|(()=>void);setError('');
    const {data,format='json',plugin}=presentation;
    const text=format==='text'?String(data):format==='jsonl'?(Array.isArray(data)?data:[data]).map(record=>JSON.stringify(record)).join('\n'):JSON.stringify(data,null,2);
    const downloadURL=URL.createObjectURL(new Blob([text],{type:format==='text'?'text/plain;charset=utf-8':format==='jsonl'?'application/x-ndjson;charset=utf-8':'application/json;charset=utf-8'}));
    const rawURL=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const openFiles=()=>{location.hash=`view=${plugin}&files=1`};
    void mountReplay(archive).then(async()=>{
      if(!current)return;
      const files=doc.getElementById('files') as HTMLAnchorElement|null;if(files){files.href=`#view=${plugin}&files=1`;files.addEventListener('click',event=>{event.preventDefault();openFiles()})}
      const download=doc.getElementById('download') as HTMLAnchorElement|null;if(download){download.href=downloadURL;download.download=presentation.filename||`${plugin}.${format==='text'?'txt':format}`;}
      const raw=doc.getElementById('raw') as HTMLAnchorElement|null;if(raw){raw.href=rawURL;raw.target='_blank';raw.rel='noopener';}
      if(hideTitlebar){const header=doc.querySelector('header');if(header)header.style.display='none';}
      cleanup=await presentation.initialize(doc,data,{downloadURL,rawURL,openFiles,resourceURL:(value,base)=>{
        if(!value)return undefined;try{const url=new URL(value,base||archive.metadata?.url).href,entry=archive.find(url);return entry?recordURL(archive,entry):undefined;}catch{return undefined;}
      }});
      if(!current)cleanup?.();
    }).catch(error=>{if(current)setError(String(error))});
    return()=>{current=false;cleanup?.();URL.revokeObjectURL(downloadURL);URL.revokeObjectURL(rawURL)};
  },[archive,doc,presentation,hideTitlebar]);
  // Canonical documents own their scroll viewport, like ArchiveBox's main
  // iframe. Resizing it from a body using vh causes a feedback loop (Title),
  // and splits long reports between nested scroll containers (SSL).
  return <>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title={presentation.title} className="canonical-metadata-frame" style={{width:'100%',height:'100%',border:0,display:'block'}} sandbox={presentation.nativePDF?undefined:'allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads'} srcDoc={markup} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}
