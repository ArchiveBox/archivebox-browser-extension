import type { HookContext } from '@/src/capture/types';
export default async function(ctx: HookContext) {
  const events: unknown[] = [];
  for (const method of ['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded']) await ctx.page.on(method, params => { if(events.length<10000) events.push({method,params}); });
  await ctx.page.command('Runtime.enable'); await ctx.page.command('Log.enable');
  ctx.ready(); await ctx.untilStopped();
  return { records: [await ctx.archive.addResource({kind:'consolelog',mime:'application/json',body:JSON.stringify(events)})], summary: `${events.length} console events` };
}
