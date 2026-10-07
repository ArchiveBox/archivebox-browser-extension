import type {ArchiveReader} from '@/src/archive/reader';
import {createArchivedTransport} from '../python/transport';
import {runExtractorWorker} from '../python/worker-client';
import {solveYtdlpChallenge} from '@/src/capture/ytdlp-solver';
import {cachedDerivedJSON} from '@/src/archive/derived-cache';
declare const __ABX_PYTHON_RUNTIME_REVISION__:string;
/** Re-run actual upstream extractors using only captured request identities. */
export async function extractArchivedYtdlp(archive:ArchiveReader,url:string,limit:number,refs:{url:string;ts:number}[],userAgent?:string,signal?:AbortSignal,format='bv*+ba/b'){
  return cachedDerivedJSON(archive,'ytdlp',[import.meta.url,__ABX_PYTHON_RUNTIME_REVISION__,url,limit,refs,userAgent,format],async()=>{
  signal?.throwIfAborted();
  const preparing=createArchivedTransport(archive,refs),controller=new AbortController();
  signal?.throwIfAborted();
  const running=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  try{
    const [request,result]=await Promise.all([preparing,runExtractorWorker('ytdlp',[url,{playlistLimit:limit,format},userAgent],{request:async(...args)=>(await preparing)(...args),log:()=>{},solve:source=>solveYtdlpChallenge(source,running)},running)]);
    if(request.failures.length)throw Error(request.failures.join('\n'));
    return result;
  }finally{controller.abort()}
  },signal);
}
