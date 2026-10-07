import type {HookContext,HookResult} from '@/src/capture/types';
import {createPaperRuntime} from '@/vendor/papers-dl/runtime';
import {createCaptureTransport,createCapturedTransport} from '@/vendor/python/transport';

// Canonical ArchiveBox input normalization; other inputs reach the upstream CLI
// fetch semantics unchanged through PAPERSDL_QUERY (DOI, PMID, URL, arXiv ID).
export function paperIdentifier(url:string,query:unknown){
  if(typeof query==='string'&&query.trim())return query.trim();
  const doi=url.match(/10\.\d{4,}\/[^\s]+/)?.[0];
  const arxiv=(doi?.match(/10\.48550\/arXiv\.(\d{4}\.\d{4,5}(?:v\d+)?)/i)||url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i))?.[1];
  return arxiv?`arXiv:${arxiv}`:doi||url;
}

export default async function(ctx:HookContext):Promise<HookResult>{
  const identifier=paperIdentifier(ctx.url,ctx.config.PAPERSDL_QUERY),providers=String(ctx.config.PAPERSDL_PROVIDERS||'all');
  const transport=createCaptureTransport(ctx,{maxBytes:Number(ctx.config.PAPERSDL_MAX_BYTES)||100_000_000,maxRequests:Number(ctx.config.PAPERSDL_MAX_REQUESTS)||100});
  ctx.log(`papers-dl 0.0.25 Python: identifier=${identifier}; providers=${providers}`);
  let runtime:Awaited<ReturnType<typeof createPaperRuntime>>|undefined;
  try{
    runtime=await createPaperRuntime(transport.request,ctx.log,ctx.signal);
    const result=await runtime.acquire(identifier,providers,String(ctx.config.PAPERSDL_USER_AGENT||''));
    if(!result.found)return {status:'noresults',records:transport.records,summary:`papers-dl found no PDF for ${identifier}. Original provider responses retained.`};
    // Verify the acquired original independently of a provider's claimed MIME.
    const pdfs=[];
    const unique=new Map(transport.records.map(ref=>[`${ref.url} ${ref.ts}`,ref]));
    for(const ref of unique.values()){const response=await ctx.archive.read(ref);if(response.status>=200&&response.status<300&&response.mime.split(';')[0]==='application/pdf'&&new TextDecoder().decode(response.body.slice(0,1024)).includes('%PDF-'))pdfs.push(ref);}
    if(pdfs.length){
      runtime.dispose();
      const recorded=await createCapturedTransport(ctx,transport.records),missing:string[]=[];
      runtime=await createPaperRuntime(async(...args)=>{try{return await recorded(...args);}catch(error){missing.push(String(error));throw error;}},ctx.log,ctx.signal);
      await runtime.parse(identifier);
      for(const ref of pdfs)await runtime.describe((await ctx.archive.read(ref)).body);
      if(missing.length)throw Error('Offline paper inference needs uncaptured evidence: '+[...new Set(missing)].join('; '));
      ctx.log('Offline papers-dl parser and pdf2doi inference verified against recorded responses before finalization.');
    }
    return {status:pdfs.length?'succeeded':'failed',records:transport.records,summary:pdfs.length?`papers-dl 0.0.25 acquired ${result.size} original PDF bytes; pdf2doi 1.5.1 discovery responses archived for offline inference.`:'Upstream returned PDF MIME without valid PDF bytes.'};
  }catch(error){return {status:ctx.signal.aborted?'killed':'failed',records:transport.records,summary:`papers-dl: ${String(error)}`};}finally{runtime?.dispose();}
}
