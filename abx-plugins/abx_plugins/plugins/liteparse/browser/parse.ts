import type {ParseResult} from '@llamaindex/liteparse-wasm';
import {playerURL,isExtension} from '@/src/replay/client';
export type ParsedDocument=ParseResult&{engine:{pdf:string;ocr:string;ocrPages:number}};
let queue:Promise<unknown>=Promise.resolve();
let sandbox:{frame:HTMLIFrameElement;ready:boolean}|undefined;
export function parseDocument(read:()=>Promise<Uint8Array>,mime:string,config:Record<string,unknown>,signal:AbortSignal,preview:(result:ParsedDocument)=>void):Promise<ParsedDocument>{
  const result=queue.then(async()=>{signal.throwIfAborted();const bytes=await read();signal.throwIfAborted();return run(bytes,mime,config,signal,preview)});queue=result.catch(()=>{});return result;
}
function run(bytes:Uint8Array,mime:string,config:Record<string,unknown>,signal:AbortSignal,preview:(result:ParsedDocument)=>void):Promise<ParsedDocument>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    if(!sandbox?.frame.isConnected){
      const frame=document.createElement('iframe');frame.hidden=true;frame.sandbox.add('allow-scripts');
      if(!isExtension)frame.sandbox.add('allow-same-origin');
      frame.src=playerURL('ocr-sandbox.html');sandbox={frame,ready:false};
    }
    const current=sandbox,{frame}=current,id=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timeout);removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    // Completed jobs share the model. Cancellation destroys the runtime so a
    // timed-out native call cannot hold up the next queued document.
    const fail=(error:unknown)=>{cleanup();frame.remove();if(sandbox===current)sandbox=undefined;reject(error)};
    const abort=()=>fail(signal.reason||new DOMException('Aborted','AbortError'));
    const send=()=>{
      // ArchiveReader may coalesce this body with another consumer. Transfer
      // an owned buffer so their preserved bytes are never detached.
      const owned=bytes.slice();frame.contentWindow!.postMessage({type:'parse-document',id,bytes:owned,mime,config,assetRoot:playerURL('')},'*',[owned.buffer]);
    };
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.contentWindow)return;
      if(event.data?.type==='document-parser-ready'){
        current.ready=true;send();
      }
      if(event.data?.type==='document-parser-progress'&&event.data.id===id)frame.dataset.status=event.data.stage;
      if(event.data?.type==='document-parser-preview'&&event.data.id===id)preview(event.data.result);
      if(event.data?.type==='parsed-document'&&event.data.id===id){if(event.data.error)fail(Error(event.data.error));else{cleanup();resolve(event.data.result)}}
    };
    const timeout=setTimeout(()=>fail(Error('Document parsing timed out')),Math.max(10,Number(config.LITEPARSE_TIMEOUT)||180)*1000);
    addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    if(current.ready)send();else document.body.append(frame);
  });
}
