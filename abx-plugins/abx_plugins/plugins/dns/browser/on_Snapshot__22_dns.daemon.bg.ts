import type { HookContext } from '@/src/capture/types';
export default async function(ctx: HookContext) {
  const requests = new Map<string, string>();
  const failures: {url:string;error:string;timestamp:number}[] = [];
  await ctx.page.on('Network.requestWillBeSent', ({requestId,request}) => requests.set(requestId, request.url));
  await ctx.page.on('Network.loadingFinished', ({requestId}) => requests.delete(requestId));
  await ctx.page.on('Network.loadingFailed', ({requestId,errorText,timestamp}) => {
    const url = requests.get(requestId); requests.delete(requestId);
    if (url && /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_DNS_/.test(errorText) && failures.length < 10000) failures.push({url,error:errorText,timestamp});
  });
  ctx.ready(); await ctx.untilStopped();
  return { summary: `${failures.length} DNS failures; successful connections are retained on original responses`,
    records: failures.length ? [await ctx.archive.addResource({kind:'dns-failures',mime:'application/json',body:JSON.stringify(failures)})] : [] };
}
