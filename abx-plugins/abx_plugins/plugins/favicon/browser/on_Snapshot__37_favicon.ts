import type { HookContext } from '@/src/capture/types';
export default async function(ctx: HookContext) {
  const urls = await ctx.page.evaluate<string[]>(`[...new Set([...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')].map(el=>el.href).concat(new URL('/favicon.ico',location.href==='about:blank'?${JSON.stringify(ctx.url)}:location.href).href))]`);
  const records=[]; for(const url of urls) { try { records.push(await ctx.archive.fetch(url)); } catch(error) { ctx.log(String(error)); } }
  return { records, summary: `${records.length} icon URLs archived` };
}
