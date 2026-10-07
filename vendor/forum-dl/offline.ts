import type {ArchiveReader} from '@/src/archive/reader';
import {createArchivedTransport} from '@/vendor/python/transport';
import {runExtractorWorker} from '@/vendor/python/worker-client';
import type {Extraction} from './runtime';
import {cachedDerivedJSON} from '@/src/archive/derived-cache';
declare const __ABX_PYTHON_RUNTIME_REVISION__:string;
export async function extractArchivedForum(archive:ArchiveReader,url:string,refs:{url:string;ts:number}[],files=true,signal?:AbortSignal){
  return cachedDerivedJSON(archive,'forumdl',[import.meta.url,__ABX_PYTHON_RUNTIME_REVISION__,url,refs,files],async()=>{
    const preparing=createArchivedTransport(archive,refs),controller=new AbortController();
    const running=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    try{
      const [,result]=await Promise.all([preparing,runExtractorWorker<Extraction>('forum',[url,{files}],{request:async(...args)=>(await preparing)(...args),log:()=>{}},running)]);
      return result;
    }finally{controller.abort()}
  },signal);
}
