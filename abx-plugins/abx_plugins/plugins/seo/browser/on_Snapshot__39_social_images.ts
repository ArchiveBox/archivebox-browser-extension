import type { HookContext, HookResult } from '@/src/capture/types';

export default async function(ctx: HookContext): Promise<HookResult> {
  const urls = await ctx.page.evaluate<string[]>(`(() => {
    const keys = new Set(['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']);
    return [...new Set([...document.querySelectorAll('meta[content]')].filter(el => keys.has(el.getAttribute('property') || el.getAttribute('name'))).map(el => {
      try { const url = new URL(el.getAttribute('content'), document.baseURI); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
    }).filter(Boolean))].slice(0, 4);
  })()`);
  const records = []; const failures = [];
  for (const url of urls) {
    ctx.signal.throwIfAborted();
    try { records.push(await ctx.archive.fetch(url)); }
    catch (error) { failures.push(url); ctx.log(`${url}: ${String(error)}`); }
  }
  return { status: failures.length ? 'failed' : records.length ? 'succeeded' : 'noresults', records, summary: `${records.length} social image responses archived${failures.length ? `; ${failures.length} fetches failed` : ''}` };
}
