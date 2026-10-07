import type { HookContext, HookResult } from '@/src/capture/types';

export default async function(ctx: HookContext): Promise<HookResult> {
  const current = await ctx.page.evaluate<string>('location.href');
  const url = new URL('/robots.txt', current==='about:blank'?ctx.url:current);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return { status: 'noresults', summary: 'Page has no HTTP origin for robots.txt' };
  ctx.signal.throwIfAborted();
  const record = await ctx.archive.fetch(url.href);
  return { records: [record], summary: 'Robots.txt HTTP response archived' };
}
