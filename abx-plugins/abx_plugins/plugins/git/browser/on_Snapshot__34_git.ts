import type {HookContext} from '@/src/capture/types';
import {cloneGit,normalizeGitURL} from '@/vendor/git/runtime';
import {createCaptureTransport,createCapturedTransport} from '@/vendor/python/transport';
export default async function(ctx:HookContext){
  const url=normalizeGitURL(ctx.url,String(ctx.config.GIT_DOMAINS));
  if(!url)return {status:'noresults' as const,summary:'Not a Git repository URL'};
  const transport=createCaptureTransport(ctx,{maxBytes:Number(ctx.config.GIT_MAX_BYTES),maxRequests:Number(ctx.config.GIT_MAX_REQUESTS)});
  try{
    const model=await cloneGit(url,(url,method,headers,body)=>transport.request(url,method,headers,body,Number(ctx.config.GIT_TIMEOUT)),{signal:ctx.signal,log:message=>ctx.log(message)});
    const offline=await createCapturedTransport(ctx,transport.records);
    const replay=await cloneGit(url,offline,{signal:ctx.signal});
    const metadata=(repo:typeof model)=>JSON.stringify({head:repo.head,files:repo.files,submodules:repo.submodules});
    if(offline.failures.length||metadata(model)!==metadata(replay))throw Error('Offline Git reconstruction does not match the captured repository');
    ctx.log(`Verified offline Git checkout ${model.head}: ${model.files.length} files and ${model.submodules.length} recursive submodules at their pinned gitlinks.`);
    return {status:'succeeded' as const,records:transport.records,summary:`${model.files.length} files · ${model.submodules.length} pinned submodules · ${model.head}`};
  }catch(error){ctx.log(String(error));const missing=(error as {code?:string;data?:{statusCode?:number}}).code==='HttpError'&&(error as any).data?.statusCode===404;
    return {status:missing?'noresults' as const:ctx.signal.aborted?'killed' as const:'failed' as const,records:transport.records,summary:String(error)};
  }
}
