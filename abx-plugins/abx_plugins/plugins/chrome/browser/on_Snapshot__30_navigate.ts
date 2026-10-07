import type { HookContext } from '@/src/capture/types';
export default async function(ctx: HookContext) {
  let resolveLoaded!: () => void;
  let nativePDF = false;
  const loaded = new Promise<void>(resolve => { resolveLoaded=resolve; });
  const stopLoad = await ctx.page.on('Page.loadEventFired', resolveLoaded);
  // Chrome's native PDF viewer detaches extension debuggers before the CDP
  // load event. The host checks tabs.onUpdated completion and the real PDF
  // document state before publishing this separate lifecycle event.
  const stopPDF = await ctx.page.on('ArchiveBox.nativePDFLoaded', () => { nativePDF=true;resolveLoaded(); });
  const responses:{url:string;frameId:string}[]=[];
  const stopResponses=await ctx.page.on('Fetch.requestPaused',event=>{if(event.resourceType==='Document'&&event.responseStatusCode>=200&&event.responseStatusCode<300&&event.responseStatusCode!==206)responses.push({url:event.request.url,frameId:event.frameId})});
  try {
    const current = await ctx.page.evaluate<string>('location.href');
    if (current === ctx.url) await ctx.page.command('Page.reload', { ignoreCache: true });
    else {
      const result = await ctx.page.command('Page.navigate', { url: ctx.url });
      if(result.isDownload){
        // The host drains the recorder before returning a native download.
        // Confirm this navigation's actual complete response, never an unrelated
        // previous resource or an arbitrary ERR_ABORTED navigation failure.
        const response=responses.findLast(response=>response.frameId===result.frameId);
        const ref=response&&(await ctx.archive.entries()).findLast(entry=>entry.url===response.url&&entry.status>=200&&entry.status<300&&entry.status!==206&&entry.method!=='HEAD');
        if(!ref)throw Error('Native download has no complete archived response');
        const original=await ctx.archive.read(ref);if(!original.body.length)throw Error('Native download archived an empty response');
        const disposition=original.headers['content-disposition']||'',name=/filename="([^"]+)"|filename=([^;]+)/i.exec(disposition)?.slice(1).find(Boolean)||new URL(ref.url).pathname.split('/').pop()||ref.url;
        return {summary:`Original download archived: ${name} (${original.body.length} bytes)`,records:[ref],data:{download:{ref,name,mime:original.mime,size:original.body.length}}};
      }
      if (result.errorText) throw Error(result.errorText);
    }
    await loaded;
    await ctx.sleep(1000);
    return { summary: nativePDF ? 'Original PDF received; native PDF tab completed loading' : 'Page loaded with network recording enabled' };
  } finally { stopLoad();stopPDF();stopResponses(); }
}
