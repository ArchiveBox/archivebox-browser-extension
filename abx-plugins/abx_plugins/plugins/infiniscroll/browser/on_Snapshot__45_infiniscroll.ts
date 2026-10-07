import type { HookContext } from '@/src/capture/types';
import type {ScrollFrame} from './presentation';

export default async function(ctx: HookContext) {
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(ctx.config[key]);
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
  };
  const budget = bounded('INFINISCROLL_TIMEOUT', 5, 0, 30) * 1000;
  const delay = bounded('INFINISCROLL_SCROLL_DELAY', 500, 100, 2000);
  const distance = bounded('INFINISCROLL_SCROLL_DISTANCE', 800, 100, 3000);
  const limit = bounded('INFINISCROLL_SCROLL_LIMIT', 10, 0, 60);
  const measure=`({timestamp:Date.now(),x:scrollX,y:scrollY,width:document.scrollingElement?.scrollWidth||0,height:document.scrollingElement?.scrollHeight||0,viewportWidth:innerWidth,viewportHeight:innerHeight})`;
  const initial = await ctx.page.evaluate<ScrollFrame>(measure);
  const started = initial.timestamp;
  const frames:ScrollFrame[]=[{...initial,phase:'Initial',elapsedMs:0}];
  let steps = 0, expanded = 0, stableBottom = 0, height = initial.height;
  try {
    while (!ctx.signal.aborted && steps < limit && Date.now() - started < budget) {
      const result = await ctx.page.evaluate<ScrollFrame & {expanded:number;bottom:boolean}>(`(() => {
        let expanded = 0;
        if (${ctx.config.INFINISCROLL_EXPAND_DETAILS !== false}) {
          for (const el of document.querySelectorAll('details:not([open])')) { el.open = true; expanded++; }
        }
        const root = document.scrollingElement;
        if (!root) return {...${measure},expanded,bottom:true};
        window.scrollBy({top:${distance},left:0,behavior:'instant'});
        return {...${measure},expanded,bottom:root.scrollTop + innerHeight >= root.scrollHeight - 2};
      })()`);
      expanded += result.expanded; steps++;
      frames.push({...result,phase:'Scroll',step:steps,elapsedMs:result.timestamp-started});
      stableBottom = result.bottom && result.height === height ? stableBottom + 1 : 0;
      height = result.height;
      if (stableBottom >= 2) break;
      await ctx.sleep(Math.min(delay, Math.max(0, budget - (Date.now() - started))));
    }
  } catch (error) {
    if (!ctx.signal.aborted) throw error;
  } finally {
    const final=await ctx.page.evaluate<ScrollFrame>(measure);height=final.height;
    frames.push({...final,phase:'Final',elapsedMs:final.timestamp-started});
    await ctx.page.evaluate(`window.scrollTo({left:${initial.x},top:${initial.y},behavior:'instant'})`);
  }
  const evidence = {version:1,frames,steps, expanded, initialHeight:initial.height, finalHeight:height,
    elapsedMs:Date.now()-started, stopped:ctx.signal.aborted};
  return {status:ctx.signal.aborted ? 'killed' as const : steps || expanded ? 'succeeded' as const : 'noresults' as const,
    summary:`${steps} scroll steps; ${expanded} details expanded`,
    records:[await ctx.archive.addResource({kind:'infiniscroll',mime:'application/json',body:JSON.stringify(evidence)})]};
}
