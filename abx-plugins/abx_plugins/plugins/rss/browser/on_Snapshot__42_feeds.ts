import type { HookContext, HookResult } from '@/src/capture/types';

export default async function(ctx: HookContext): Promise<HookResult> {
  const urls = await ctx.page.evaluate<string[]>(`(() => [...new Set([...document.querySelectorAll('link[rel~="alternate"][href]')].filter(el => /(?:rss|atom|feed\\+json)/i.test(el.getAttribute('type') || '')).map(el => {
    try { const url = new URL(el.getAttribute('href'), document.baseURI); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }).filter(Boolean))].slice(0, 8))()`);
  const records = []; let failures = 0;
  for (const url of urls) {
    ctx.signal.throwIfAborted();
    try { records.push(await ctx.archive.fetch(url)); }
    catch (error) { failures++; ctx.log(`${url}: ${String(error)}`); }
  }
  return { status: failures ? 'failed' : records.length ? 'succeeded' : 'noresults', records, summary: `${records.length} feed responses archived${failures ? `; ${failures} fetches failed` : ''}` };
}
