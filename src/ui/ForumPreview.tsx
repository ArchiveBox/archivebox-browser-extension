import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import type {ForumPresentation} from '../../abx-plugins/abx_plugins/plugins/forumdl/browser/view';
import {mountReplay,recordURL} from '../archive/replay';
import {pluginIcon} from './presentation';
import {initializeForum} from './forum-template';
import fullTemplate from '../../vendor/archivebox/plugins/forumdl/full.html?raw';
const markup=fullTemplate.replace(/<script>[\s\S]*?<\/script>/,'').replace('{{ plugin_icon }}',pluginIcon('forumdl'));
function options(archive:ArchiveReader,presentation:ForumPresentation,url:string){
  const text=presentation.records.map(record=>JSON.stringify(record)).join('\n')+'\n';
  const downloadURL=URL.createObjectURL(new Blob([text],{type:'application/x-ndjson;charset=utf-8'}));
  const rawURL=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  return {url,downloadURL,rawURL,openFiles:()=>{location.hash='view=forumdl&files=1'},resourceURL:(value:string|null,base:string)=>{
    if(!value)return;try{const resource=new URL(value,base);const entry=archive.find(resource.href);return entry?recordURL(archive,entry):undefined}catch{return}
  }};
}
export function ForumPreview({archive,presentation,url}:{archive:ArchiveReader;presentation:ForumPresentation;url:string}){
  const frame=React.useRef<HTMLIFrameElement>(null),[doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
  React.useEffect(()=>{if(!doc)return;let current=true;const context=options(archive,presentation,url);
    void mountReplay(archive).then(()=>{if(current){const start=performance.now();initializeForum(doc,presentation.records,context);performance.measure('archivebox:forum:render',{start})}}).catch(error=>{if(current)setError(String(error))});
    const resize=()=>{if(frame.current)frame.current.style.height=Math.max(320,doc.body.scrollHeight)+'px'};const observer=new ResizeObserver(resize);observer.observe(doc.body);resize();
    return()=>{current=false;observer.disconnect();URL.revokeObjectURL(context.downloadURL);URL.revokeObjectURL(context.rawURL)};
  },[archive,presentation,url,doc]);
  return <>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title="Forum thread" style={{width:'100%',border:0,minHeight:320,display:'block'}} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" srcDoc={markup} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}
