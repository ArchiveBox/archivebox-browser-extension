import type {HookContext} from '@/src/capture/types';
import {closeModals,type ModalAction} from './close-modals';

export default async function(ctx:HookContext){
  if(ctx.config.MODALCLOSER_ENABLED===false){ctx.ready();return {status:'skipped' as const,summary:'MODALCLOSER_ENABLED=False'}}
  const delay=Number(ctx.config.MODALCLOSER_TIMEOUT??1250),interval=Number(ctx.config.MODALCLOSER_POLL_INTERVAL??500);
  if(!Number.isFinite(delay)||delay<100||!Number.isFinite(interval)||interval<100)throw Error('Modalcloser timing must be at least 100ms');
  const actions:(ModalAction&{time:number})[]=[],dialogs:{type:string;message:string;accepted:boolean;time:number}[]=[],pending=new Set<Promise<void>>();
  const unsubscribe=await ctx.page.on('Page.javascriptDialogOpening',event=>{
    const task=(async()=>{
      try{
        await ctx.sleep(delay);
        // Keep the captured tab in place when Browsertrix tries a normal link.
        // Alerts, confirms and prompts retain the canonical accept behavior.
        const accepted=event.type!=='beforeunload';
        await ctx.page.command('Page.handleJavaScriptDialog',{accept:accepted});
        dialogs.push({type:event.type,message:String(event.message||''),accepted,time:Date.now()});
        ctx.log(`${dialogs.length} browser dialogs, ${actions.length} CSS modals closed`);
      }catch(error){if(!ctx.signal.aborted&&!/No dialog is showing/.test(String(error)))ctx.log(`Dialog dismissal failed: ${error}`)}
    })();pending.add(task);void task.finally(()=>pending.delete(task));
  });
  ctx.ready();
  try{
    while(!ctx.signal.aborted){
      try{
        const found=await ctx.page.evaluate<ModalAction[]>(`(${closeModals.toString()})()`);
        actions.push(...found.map(action=>({...action,time:Date.now()})));
        if(found.length)ctx.log(`${dialogs.length} browser dialogs, ${actions.length} CSS modals closed`);
      }catch(error){if(!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error)))throw error}
      await ctx.sleep(interval);
    }
  }catch(error){if(!ctx.signal.aborted)throw error}
  finally{unsubscribe();await Promise.allSettled([...pending])}
  const total=actions.length+dialogs.length;
  return {status:total?'succeeded' as const:'noresults' as const,summary:`${dialogs.length} browser dialogs, ${actions.length} CSS modals closed`,
    records:[await ctx.archive.addResource({kind:'modalcloser',mime:'application/json',body:JSON.stringify({actions,dialogs})})]};
}
