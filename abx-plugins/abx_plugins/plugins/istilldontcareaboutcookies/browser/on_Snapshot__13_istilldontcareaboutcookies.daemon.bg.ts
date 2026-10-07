import type { HookContext } from '@/src/capture/types';

export default async function(ctx: HookContext) {
  const value = Number(ctx.config.COOKIE_BANNER_MAX_ACTIONS);
  const limit = Math.min(30, Math.max(0, Number.isFinite(value) ? value : 10));
  const actions: {selector:string;label:string}[] = [];
  const key = JSON.stringify(`__archivebox_cookie_rejection_${ctx.captureId}`);
  const selectors = ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline',
    'button.cky-btn-reject', 'button.cmplz-deny', 'button.osano-cm-denyAll'];
  ctx.ready();
  try {
    while (!ctx.signal.aborted && actions.length < limit) {
      try {
        const found = await ctx.page.evaluate<{selector:string;label:string}[]>(`(() => {
          const out=[], clicked=self[${key}] || (self[${key}]=new WeakSet());
          for (const selector of ${JSON.stringify(selectors)}) {
            for (const el of document.querySelectorAll(selector)) {
              if (out.length >= ${limit-actions.length}) return out;
              if (clicked.has(el) || !(el instanceof HTMLButtonElement) || el.disabled || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
              if (el.form && el.type === 'submit') continue;
              clicked.add(el);
              out.push({selector,label:(el.textContent || '').trim().slice(0,120)});
              el.click();
            }
          }
          return out;
        })()`);
        actions.push(...found);
      } catch (error) {
        if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error))) throw error;
      }
      await ctx.sleep(500);
    }
    if (!ctx.signal.aborted) await ctx.untilStopped();
  } catch (error) { if (!ctx.signal.aborted) throw error; }
  await ctx.page.evaluate(`delete self[${key}]`);
  return {status:actions.length ? 'succeeded' as const : 'noresults' as const,
    summary:`${actions.length} cookie rejection controls clicked`,
    records:[await ctx.archive.addResource({kind:'istilldontcareaboutcookies',mime:'application/json',body:JSON.stringify({actions})})]};
}
