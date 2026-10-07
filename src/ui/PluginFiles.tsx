import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import type {Capture} from '../capture/types';
import {pluginFiles,originalFilename} from '../archive/plugin-files';
import {recordURL} from '../archive/replay';
import {pluginName} from './presentation';
import {views,deriveView} from '../archive/views';
import {mountDirectoryBrowser,type DirectoryFile} from './directory-browser';
import {memberMime} from '../archive/zip-members';

export function PluginFiles({archive,capture,name}:{archive:ArchiveReader;capture:Capture;name:string}){
  const host=React.useRef<HTMLDivElement>(null),[error,setError]=React.useState(''),[loading,setLoading]=React.useState(true);
  React.useEffect(()=>{
    let current=true,cleanup:(()=>void)|undefined;const controller=new AbortController();setError('');setLoading(true);
    void(async()=>{
      let files:DirectoryFile[];
      if(name==='git'){
        const view=await deriveView(name,{archive,capture,url:capture.finalUrl||capture.url,signal:controller.signal});
        const repository=view.presentation?.type==='git'?view.presentation.repository:null;
        files=(repository?.files||[]).map(file=>({path:file.path,size:file.size,mime:memberMime(file.path),read:async()=>new Blob([await repository!.read(file.path) as BlobPart],{type:memberMime(file.path)})}));
      }else{
        const hooks=capture.hooks.filter(hook=>hook.plugin===name);
        const named=hooks.flatMap(hook=>{const data=hook.data as {exports?:{path:string;ref:{url:string;ts:number}}[]}|undefined;return data?.exports||[]});
        const used=new Set<string>();
        files=await Promise.all((await pluginFiles(archive,capture,name)).map(async entry=>{
          const {headers}=await archive.headers(entry),responseHeaders=new Headers(headers);
          const output=archive.metadata?.files.find(file=>file.url===entry.url&&file.ts===entry.ts);
          let path=named.find(file=>file.ref.url===entry.url&&file.ref.ts===entry.ts)?.path||entry.path?.replace(new RegExp(`^${name}/`),'')||originalFilename(entry);
          const base=path;let suffix=1;while(used.has(path)){const dot=base.lastIndexOf('.');path=dot>base.lastIndexOf('/')?`${base.slice(0,dot)}-${++suffix}${base.slice(dot)}`:`${base}-${++suffix}`}used.add(path);
          const length=responseHeaders.get('content-length');
          return {path,mime:entry.mime,size:output?.bytes??(length!==null&&/^\d+$/.test(length)?Number(length):undefined),title:entry.url,url:recordURL(archive,entry),
            href:/^https?:/.test(entry.url)?`#view=responses&request=${encodeURIComponent(entry.url)}&ts=${entry.ts}`:undefined,
            read:async()=>new Blob([(await archive.read(entry)).body as BlobPart],{type:entry.mime})};
        }));
      }
      if(name==='singlefile')files.push({path:'singlefile.html',mime:'text/html',read:async()=>{
        const view=await deriveView(name,{archive,capture,url:capture.finalUrl||capture.url,signal:controller.signal});
        const section=view.sections.find(section=>section.type==='html');if(section?.type!=='html')throw Error('SingleFile did not return an HTML document');
        return new Blob([section.html],{type:'text/html;charset=utf-8'});
      }});
      if(!current)return;
      cleanup=mountDirectoryBrowser(host.current!,{title:pluginName(name),files,snapshot:()=>{location.hash=''},output:views[name]?()=>{location.hash=`view=${name}`}:undefined});setLoading(false);
    })().catch(reason=>{if(current){setError(String(reason));setLoading(false)}});
    return()=>{current=false;controller.abort();cleanup?.()};
  },[archive,capture,name]);
  return <section className="plugin-files">{error&&<p role="alert">{error}</p>}{loading&&<p>Loading files…</p>}<div ref={host}/></section>;
}
