import type {ExtractorRequest} from '@/vendor/python/transport';
import type {PaperRuntime} from './engine';
import {openExtractorWorker} from '../python/worker-client';

/** Each interpreter owns a worker: Pyodide native extensions share JS globals. */
export async function createPaperRuntime(request:ExtractorRequest,log:(message:string)=>void,signal?:AbortSignal){
  const {call,dispose}=await openExtractorWorker('papers',{request,log},signal);
  return {
    acquire:(...args:Parameters<PaperRuntime['acquire']>)=>call('acquire',args) as ReturnType<PaperRuntime['acquire']>,
    describe:(...args:Parameters<PaperRuntime['describe']>)=>call('describe',args) as ReturnType<PaperRuntime['describe']>,
    parse:(...args:Parameters<PaperRuntime['parse']>)=>call('parse',args) as ReturnType<PaperRuntime['parse']>,
    dispose,
  };
}
