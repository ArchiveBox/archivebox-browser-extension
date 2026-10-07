import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import {mountReplay,recordURL} from '../archive/replay';
import type {DocumentSource} from '../../abx-plugins/abx_plugins/plugins/liteparse/browser/view';
import {initializeLiteParse} from './liteparse-template';
import fullTemplate from '../../vendor/archivebox/plugins/liteparse/full.html?raw';
import {pluginIcon} from './presentation';
const markup=fullTemplate.replace(/<script>[\s\S]*?<\/script>/,'').replace('{{ plugin_icon }}',pluginIcon('liteparse'));

/** Literal canonical document. This trusted UI iframe stays unsandboxed because
 * Chromium blocks its native PDF viewer inside a sandboxed ancestor. */
export function DocumentPreview({archive,documents}:{archive:ArchiveReader;documents:DocumentSource[]}){
  const frame=React.useRef<HTMLIFrameElement>(null),[doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
  React.useEffect(()=>{if(!doc)return;let current=true,cleanup:(()=>void)|undefined;
    void mountReplay(archive).then(()=>{if(current)cleanup=initializeLiteParse(doc,documents,{url:archive.metadata?.finalUrl||archive.metadata?.url||archive.pages[0]?.url||'',openFiles:()=>{location.hash='view=liteparse&files=1'},resourceURL:entry=>recordURL(archive,entry),originalPDF:async source=>URL.createObjectURL(new Blob([(source.original?await source.original():await archive.read(source.entry)).body as BlobPart],{type:'application/pdf'}))})}).catch(error=>{if(current)setError(String(error))});
    return()=>{current=false;cleanup?.()};
  },[archive,doc,documents]);
  React.useEffect(()=>{if(!doc)return;const resize=()=>{if(frame.current)frame.current.style.height=Math.max(320,doc.body.scrollHeight)+'px'};const observer=new ResizeObserver(resize);observer.observe(doc.body);resize();return()=>observer.disconnect()},[doc]);
  return <>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title="LiteParse" style={{width:'100%',border:0,minHeight:320,display:'block'}} srcDoc={markup} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}
