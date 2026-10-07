const policyViolations:string[]=[];
const diagnostics:string[]=[];
self.addEventListener('securitypolicyviolation',event=>policyViolations.push(`Python sandbox blocked ${event.violatedDirective}: ${event.blockedURI}`));
import type {PythonEngine,PythonTransport} from './worker-client';
import type {PaperRuntime} from '../papers-dl/engine';
let next=0,runtime:PaperRuntime|undefined;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
const invoke=(method:string,args:unknown[])=>new Promise<any>((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});self.postMessage({type:'transport',id,method,args});});
const transport:Required<PythonTransport>={request:(...args)=>invoke('request',args),log:message=>{diagnostics.push(message);self.postMessage({type:'log',message});},sleep:seconds=>invoke('sleep',[seconds]),solve:source=>invoke('solve',[source])};
self.onmessage=async({data})=>{
  if(data.type==='response'){const job=pending.get(data.id);if(job){pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);}return;}
  if(data.type!=='call')return;
  try{
    let result:unknown;
    (self as typeof self&{archiveboxAssetRoot:string}).archiveboxAssetRoot=data.assetRoot;
    const engine=data.engine as PythonEngine;
    if(data.method==='init'){
      if(engine==='papers')runtime=await (await import('../papers-dl/engine')).createPaperRuntime(transport.request,transport.log);
    }else if(engine==='papers'){
      if(!runtime||!['acquire','describe','parse'].includes(data.method))throw Error('Unknown paper operation');
      result=await (runtime[data.method as keyof PaperRuntime] as (...args:any[])=>Promise<unknown>)(...data.args);
    }else if(data.method==='extract'){
      const [url,options,download]=data.args;
      if(engine==='gallery')result=await (await import('../gallery-dl/runtime')).extractGallery(url,options,transport,download);
      else if(engine==='forum')result=await (await import('../forum-dl/runtime')).extractForum(url,transport,options);
      else if(engine==='ytdlp')result=await (await import('../yt-dlp/runtime')).extractYtdlp(url,options,transport,download);
    }else throw Error('Unknown Python extractor operation');
    if(policyViolations.length)throw Error([...new Set(policyViolations),...diagnostics].join('\n'));
    const timings=performance.getEntriesByType('measure').map(entry=>({name:entry.name,start:performance.timeOrigin+entry.startTime,duration:entry.duration}));performance.clearMeasures();
    self.postMessage({type:'result',id:data.id,result,timings});
  }catch(error){self.postMessage({type:'result',id:data.id,error:String(error)});}
};
