import type { HookContext, RecordRef } from '@/src/capture/types';
export default async function(ctx:HookContext) {
  const limit = Math.max(0,Math.min(500,Number(ctx.config.ARCHIVEWEBPAGE_MAX_REQUISITES) || 0));
  const discovery = await ctx.page.evaluate<{urls:string[];total:number}>(`(() => {
    const manager=self.__bx_behaviors;
    if(!manager?.autofetch)throw Error('Bundled Browsertrix Autofetcher unavailable');
    // Reuse upstream discovery without starting its independent fetch queue.
    const fetcher=new manager.autofetch.constructor(false);
    fetcher.extractSrcSrcSetAll(document);
    fetcher.extractStyleSheets();
    for(const el of document.querySelectorAll('img[src],img[data-src],input[type="image"][src],video[poster],link[rel="stylesheet"][href]')) {
      for(const attr of ['src','data-src','poster','href']) { const url=el.getAttribute(attr); if(url)fetcher.queueUrl(url); }
    }
    for(const el of document.querySelectorAll('[style]'))fetcher.extractStyleText(el.getAttribute('style'));
    if(${ctx.config.ARCHIVEWEBPAGE_DATA_ATTRIBUTES === true})fetcher.extractDataAttributes(document);
    return {urls:fetcher.waitQueue.slice(0,${limit}),total:fetcher.waitQueue.length};
  })()`);
  const records:RecordRef[] = []; const errors:string[] = [];
  let index=0;
  await Promise.all(Array.from({length:Math.min(6,discovery.urls.length)},async()=>{
    while(index<discovery.urls.length && !ctx.signal.aborted) {
      const url=discovery.urls[index++]!;
      try { records.push(await ctx.archive.fetch(url)); }
      catch(error) { errors.push(`${url}: ${error}`); ctx.log(errors.at(-1)!); }
    }
  }));
  return {status:ctx.signal.aborted?'killed' as const:errors.length?'failed' as const:records.length?'succeeded' as const:'noresults' as const,
    summary:`${records.length}/${discovery.total} discovered requisites preserved or reused; ${Math.max(0,discovery.total-discovery.urls.length)} beyond limit; ${errors.length} unavailable`,records};
}
