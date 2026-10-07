import type {HookContext,RecordRef} from '@/src/capture/types';
import {discoverMedia} from './discover';
import {streamKind,streamPlan} from './streams';
export default async function(ctx:HookContext) {
  if(ctx.config.MEDIA_FETCH_MISSING!==true)return {status:'noresults' as const,summary:'Media inventory derives from the archived DOM and responses; additional acquisition disabled'};
  const sources=await ctx.page.evaluate<ReturnType<typeof discoverMedia>>(`(${discoverMedia.toString()})(document,document.baseURI)`);
  for(const entry of await ctx.archive.entries())if(streamKind(entry.url,entry.mime)||/^(audio|video)\//.test(entry.mime))sources.push({url:entry.url,kind:'observed response'});
  const bounded=(key:string,fallback:number,max:number)=>Math.min(max,Math.max(1,Number(ctx.config[key])||fallback));
  const limit=bounded('MEDIA_MAX_URLS',500,5000), budget=bounded('MEDIA_MAX_MB',256,4096)*1024*1024;
  const queue=[...new Set(sources.map(source=>source.url))],seen=new Set<string>(),records:RecordRef[]=[],problems:string[]=[];
  let size=0,segments=0,streams=0;
  while(queue.length && seen.size<limit && size<budget && !ctx.signal.aborted) {
    const url=queue.shift()!;if(seen.has(url))continue;seen.add(url);
    try {
      const ref=await ctx.archive.fetch(url,{maxBytes:budget-size});records.push(ref);
      const response=await ctx.archive.read(ref);size+=response.body.byteLength;
      if(response.status<200||response.status>=300)throw Error(`HTTP ${response.status}`);
      const kind=streamKind(ref.url,response.mime);
      if(kind){
        const plan=streamPlan(new TextDecoder().decode(response.body),ref.url,kind,response.metadata);streams++;segments+=plan.segments;
        queue.push(...plan.urls.filter(item=>!seen.has(item)));
        problems.push(...plan.unsupported.map(reason=>`${url}: ${reason}`));
        if(plan.live)problems.push(`${url}: live window captured; no finite complete recording`);
      } else if(/text\/html/.test(response.mime))throw Error('Received an HTML landing or access page instead of media');
    }catch(error){problems.push(`${url}: ${error}`);ctx.log(problems.at(-1)!);}
  }
  const remaining=new Set(queue.filter(url=>!seen.has(url))).size;
  if(remaining)problems.push(`${remaining} discovered resources omitted by request/byte limits`);
  for(const problem of problems)ctx.log(problem);
  return {records,status:ctx.signal.aborted?'killed' as const:problems.length?'failed' as const:records.length?'succeeded' as const:'noresults' as const,
    summary:`${records.length} original responses; ${streams} playlists, ${segments} selected segments; ${size} bytes inspected; ${remaining} pending; ${problems.length} incomplete/unsupported conditions`};
}
