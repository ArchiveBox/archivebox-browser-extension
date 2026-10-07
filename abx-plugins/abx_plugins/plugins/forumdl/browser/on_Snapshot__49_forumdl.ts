import type {HookContext} from '@/src/capture/types';
import {extractForum,type Extraction} from '@/vendor/forum-dl/runtime';
import {runExtractorWorker} from '@/vendor/python/worker-client';
import {createCaptureTransport,createCapturedTransport} from '@/vendor/python/transport';
export default async function(ctx:HookContext){
  const transport=createCaptureTransport(ctx,{maxRequests:Number(ctx.config.FORUMDL_MAX_REQUESTS??500),maxBytes:Number(ctx.config.FORUMDL_MAX_MB??256)*1024*1024});
  try{
    const page=await ctx.page.evaluate<{url:string;mime:string}>('({url:location.href,mime:document.contentType})');
    if(!/^https?:/.test(page.url)||!['text/html','application/xhtml+xml'].includes(page.mime))return {status:'noresults' as const,records:[],summary:'No rendered HTML forum page'};
    const url=page.url;
    const options={timeout:Number(ctx.config.FORUMDL_HTTP_TIMEOUT??20),files:ctx.config.FORUMDL_FILES!==false};
    const result=await extractForum(url,{request:transport.request,log:ctx.log},options);
    if(result.complete){
      const archivedRequest=await createCapturedTransport(ctx,transport.records);
      const offline=await runExtractorWorker<Extraction>('forum',[url,options],{request:archivedRequest,log:ctx.log},ctx.signal);
      if(archivedRequest.failures.length)throw Error(`Forum missing captured responses: ${archivedRequest.failures.join('; ')}`);
      if(!offline.complete)throw Error(`Forum offline derivation failed: ${offline.error}`);
      for(const key of ['family','boards','threads','posts','files'] as const)if(JSON.stringify(offline[key])!==JSON.stringify(result[key]))throw Error(`Forum offline ${key} differs from acquisition`);
      ctx.log('Verified identical complete upstream metadata using captured responses only');
    }
    const summary=`forum-dl ${result.version} ${result.family}: ${result.boards.length} boards, ${result.threads.length} threads, ${result.posts.length} posts, ${result.files.length} files; ${transport.records.length} original responses; ${result.complete?'traversal complete':result.error}`;
    ctx.log(summary);
    return {records:transport.records,status:ctx.signal.aborted?'killed' as const:result.complete?'succeeded' as const:result.family==='unsupported'&&result.error?.startsWith('Unsupported platform:')?'noresults' as const:'failed' as const,summary};
  }catch(error){return {records:transport.records,status:'failed' as const,summary:String(error)};}
}
