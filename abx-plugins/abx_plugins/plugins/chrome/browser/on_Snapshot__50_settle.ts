import type { HookContext } from '@/src/capture/types';
/** Browsertrix crawler.netIdle: advisory page readiness, never a durability gate. */
export default async function(ctx: HookContext) {
  // Upstream delays briefly before watching fetch/XHR started just after load.
  await ctx.sleep(500);
  const state=await ctx.page.waitForIdle({quietMs:500,maxWaitMs:2000,maxActiveRequests:1});
  if(state.pending||!state.idle||Object.values(state.archivePending).some(Boolean))ctx.log(JSON.stringify(state));
  return {status:'succeeded' as const,summary:state.idle
    ? `Page readiness reached with ${state.pending} active browser requests (allowance 1); archive writes are finalized at recorder shutdown`
    : `Page readiness wait expired after ${state.waitedMs}ms with ${state.pending} active browser requests; continuing to final recorder flush`};
}
