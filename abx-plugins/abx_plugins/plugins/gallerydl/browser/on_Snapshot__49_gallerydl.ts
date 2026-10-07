import type {HookContext} from '@/src/capture/types';
import {extractGallery,type GalleryResult} from '../../../../../vendor/gallery-dl/runtime';
import {runExtractorWorker} from '../../../../../vendor/python/worker-client';
import {createCaptureTransport,createCapturedTransport} from '../../../../../vendor/python/transport';
export default async function(ctx:HookContext){
  const config=JSON.parse(String(ctx.config.GALLERYDL_CONFIG || '{}'));
  const transport=createCaptureTransport(ctx,{maxBytes:Number(ctx.config.GALLERYDL_MAX_BYTES),maxRequests:Number(ctx.config.GALLERYDL_MAX_REQUESTS)});
  try{
    const url=await ctx.page.evaluate<string>('location.href');
    const result=await extractGallery(url,config,{request:transport.request,log:message=>ctx.log(message),sleep:seconds=>ctx.sleep(seconds*1000)},true);
    if(!result.supported)return {records:transport.records,status:'skipped' as const,summary:`No upstream gallery-dl extractor matches this URL (${result.extractorCount} bundled classes).`};
    if(!result.errors.length){
      ctx.log('Checking upstream gallery reconstruction using captured responses only.');
      const offline=await createCapturedTransport(ctx,transport.records);
      const replay=await runExtractorWorker<GalleryResult>('gallery',[url,config,true],{request:offline,log:message=>ctx.log(message),sleep:async()=>{}},ctx.signal);
      if(offline.failures.length||replay.errors.length)throw Error(`Offline gallery validation failed: ${[...offline.failures,...replay.errors].join('; ')}`);
      const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      if(!replay.supported||JSON.stringify(canonical(replay.messages))!==JSON.stringify(canonical(result.messages)))throw Error('Offline gallery validation returned different upstream metadata or file URLs');
      ctx.log('Offline gallery validation passed: all upstream metadata derives from captured responses.');
    }
    const failed=result.errors.length>0;
    return {records:transport.records,status:failed?'failed' as const:result.files?'succeeded' as const:'noresults' as const,summary:`gallery-dl ${result.version} ${result.extractor}: ${result.files} original files. ${failed?result.errors.join('; '):'Upstream extraction completed.'}`};
  }catch(error){ctx.log(String(error));return {records:transport.records,status:ctx.signal.aborted?'killed' as const:'failed' as const,summary:`Partial upstream gallery-dl extraction: ${String(error)}`};}
}
