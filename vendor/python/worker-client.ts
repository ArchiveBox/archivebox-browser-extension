import type {ExtractorRequest} from './transport';
import workerURL from './worker?worker&url';
export type PythonEngine='gallery'|'forum'|'papers'|'ytdlp';
export type PythonTransport={request:ExtractorRequest;log:(message:string)=>void;sleep?:(seconds:number)=>Promise<void>;solve?:(source:string)=>Promise<string>};

/** Native Python extensions and their WASM symbols belong to one worker.
 * Only original-response RPC crosses back to the capture/replay host. */
export async function openExtractorWorker(engine:PythonEngine,transport:PythonTransport,signal?:AbortSignal){
  signal?.throwIfAborted();
  const assetRoot=typeof document==='undefined'?new URL('../',self.location.href).href:new URL('./',document.baseURI).href;
  // Capture hook workers execute user-entered configuration. Imported WACZ
  // views enter through a document and always receive the opaque sandbox.
  const worker=typeof document==='undefined'?new Worker(workerURL,{type:'module'}):await isolatedWorker(assetRoot,signal);
  let next=0,closed=false;
  let requests=0,requestMilliseconds=0,responseBytes=0;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;started:number;method:string}>();
  const dispose=(reason:unknown=Error('Extractor worker closed'))=>{
    if(closed)return;closed=true;worker.terminate();signal?.removeEventListener('abort',abort);
    for(const job of pending.values())job.reject(reason instanceof Error?reason:Error(String(reason)));pending.clear();
  };
  const abort=()=>dispose(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const call=<T=unknown>(method:string,args:unknown[]=[])=>new Promise<T>((resolve,reject)=>{
    if(closed){reject(Error('Extractor worker closed'));return;}
    const id=++next;pending.set(id,{resolve,reject,started:performance.now(),method});worker.postMessage({type:'call',id,engine,assetRoot,method,args});
  });
  worker.onmessage=async({data})=>{
    if(data.type==='log'){transport.log(data.message);return;}
    if(data.type==='transport'){
      try{
        let result:unknown;
        if(data.method==='request'){
          const start=performance.now(),response=await transport.request(...data.args as Parameters<ExtractorRequest>);
          requests++;requestMilliseconds+=performance.now()-start;responseBytes+=response.body.byteLength;result=response;
        }
        else if(data.method==='sleep'&&transport.sleep)result=await transport.sleep(data.args[0]);
        else if(data.method==='solve'&&transport.solve)result=await transport.solve(data.args[0]);
        else throw Error('Unsupported extractor transport operation: '+data.method);
        if(!closed)worker.postMessage({type:'response',id:data.id,result});
      }catch(error){if(!closed)worker.postMessage({type:'response',id:data.id,error:String(error)});}return;
    }
    const job=pending.get(data.id);if(job){
      pending.delete(data.id);performance.measure(`archivebox:${engine}:${job.method}`,{start:job.started,detail:{requests,requestMilliseconds,responseBytes}});
      for(const timing of data.timings||[])performance.measure(`archivebox:${timing.name}`,{start:Math.max(0,timing.start-performance.timeOrigin),duration:timing.duration});
      data.error?job.reject(Error(data.error)):job.resolve(data.result);
    }
  };
  worker.onerror=event=>dispose(Error(event.message));
  worker.onmessageerror=()=>dispose(Error('Extractor worker returned an unreadable message'));
  try{await call('init');}catch(error){dispose(error);throw error;}
  return {call,dispose};
}
export async function runExtractorWorker<T>(engine:Exclude<PythonEngine,'papers'>,args:unknown[],transport:PythonTransport,signal?:AbortSignal):Promise<T>{
  const worker=await openExtractorWorker(engine,transport,signal);
  try{return await worker.call<T>('extract',args);}finally{worker.dispose();}
}


type WorkerEndpoint=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
async function isolatedWorker(assetRoot:string,signal?:AbortSignal):Promise<WorkerEndpoint>{
  signal?.throwIfAborted();
  const frame=document.createElement('iframe');frame.hidden=true;frame.sandbox.add('allow-scripts');
  const session=crypto.randomUUID();
  frame.src=new URL('python-sandbox.html',assetRoot).href;
  let finish:()=>void=()=>{},fail:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;});
  const endpoint:WorkerEndpoint={
    onmessage:null,onerror:null,onmessageerror:null,
    postMessage:message=>frame.contentWindow?.postMessage({type:'python-sandbox-message',session,message},'*'),
    terminate:()=>{window.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);clearTimeout(timer);frame.remove();},
  };
  const receive=(event:MessageEvent)=>{
    if(event.source!==frame.contentWindow)return;
    const data=event.data;
    if(data?.type==='python-sandbox-ready'){
      frame.contentWindow!.postMessage({type:'python-sandbox-start',session,workerURL:new URL(workerURL,location.href).href},'*');return;
    }
    if(data?.session!==session)return;
    if(data.type==='python-sandbox-started'){clearTimeout(timer);finish();}
    else if(data.type==='python-sandbox-message')endpoint.onmessage?.call(endpoint as Worker,new MessageEvent('message',{data:data.message}));
    else if(data.type==='python-sandbox-error'){
      const error=new Error(data.error);fail(error);endpoint.onerror?.call(endpoint as Worker,new ErrorEvent('error',{message:error.message}));
    }
  };
  const abort=()=>{endpoint.terminate();fail(Error('Isolated Python worker aborted'));};
  const timer=setTimeout(()=>{endpoint.terminate();fail(Error('Isolated Python sandbox did not start'));},30000);
  signal?.addEventListener('abort',abort,{once:true});window.addEventListener('message',receive);document.body.append(frame);
  try{await ready;return endpoint;}catch(error){endpoint.terminate();throw error;}
}
