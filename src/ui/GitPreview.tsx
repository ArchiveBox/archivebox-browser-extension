import React from 'react';
import {checkoutZip} from '../../vendor/git/export';
import type {GitPresentation} from '../../abx-plugins/abx_plugins/plugins/git/browser/view';
import {mountDirectoryBrowser} from './directory-browser';
import {memberMime} from '../archive/zip-members';
import {initializeGit} from './git-template';
import template from '../../vendor/archivebox/plugins/git/full.html?raw';
export function GitPreview({presentation}:{presentation:GitPresentation}){
 const frame=React.useRef<HTMLIFrameElement>(null),[doc,setDoc]=React.useState<Document|null>(null),[error,setError]=React.useState('');
 React.useEffect(()=>{if(!doc?.getElementById('entries'))return;const urls=new Map<string,string>();
  const disposeFiles=initializeGit(doc,(presentation.repository?.files||[]).map(file=>({...file,plugin:'git'})),{source:presentation.source,page:presentation.page,openFiles:()=>{location.hash='view=git&files=1'},mountFiles:(host,files)=>mountDirectoryBrowser(host,{title:'Repository files',files:files.map(file=>({...file,mime:memberMime(file.path),read:async()=>new Blob([await presentation.repository!.read(file.path) as BlobPart],{type:memberMime(file.path)})}))}),fileURL:path=>{
    const file=presentation.repository?.files.find(file=>file.path===path);if(!file)return new URL('#'+encodeURIComponent(path),document.baseURI).href;
    let url=urls.get(path);if(!url){const mime=/\.(png|jpe?g|gif|webp|svg)$/i.test(path)?'image/'+(path.toLowerCase().endsWith('.svg')?'svg+xml':path.split('.').at(-1)==='jpg'?'jpeg':path.split('.').at(-1)):'text/plain;charset=utf-8';url=URL.createObjectURL(new Blob([presentation.repository!.readSync(path) as BlobPart],{type:mime}));urls.set(path,url)}return url;
  }});
  const repository=presentation.repository;
  if(repository){const download=doc.createElement('button');download.className='button';download.textContent='Download checkout';doc.querySelector('.actions')!.append(download);download.onclick=()=>{download.disabled=true;void(async()=>{
    const href=URL.createObjectURL(await checkoutZip(repository));urls.set('checkout.zip',href);const link=document.createElement('a');link.href=href;link.download=(new URL(repository.url).pathname.split('/').filter(Boolean).at(-1)||'repository').replace(/\.git$/,'')+'-checkout.zip';link.click();
   })().catch(reason=>setError(String(reason))).finally(()=>{download.disabled=false})};}
  return()=>{disposeFiles();for(const url of urls.values())URL.revokeObjectURL(url)};
 },[doc,presentation]);
 return <>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title="Archived repository" className="document-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" srcDoc={template} onLoad={()=>setDoc(frame.current?.contentDocument||null)}/></>;
}
