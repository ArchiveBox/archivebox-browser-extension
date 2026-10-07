import type {HookContext,RecordRef} from '@/src/capture/types';

type BehaviorResult={behavior:string;behaviors:string[];steps:number;logs:unknown[];cancelled:boolean};
export default async function(ctx:HookContext){
  const page=await ctx.page.evaluate<{mime:string;url:string}>('({mime:document.contentType,url:location.href})');
  if(!/^https?:/.test(page.url)||!['text/html','application/xhtml+xml'].includes(page.mime))return {status:'noresults' as const,summary:`No HTML browser behaviors for ${page.mime}`};
  const seconds=Number(ctx.config.BROWSERTRIX_BEHAVIOR_SECONDS??30);
  if(!Number.isFinite(seconds)||seconds<1)throw Error('BROWSERTRIX_BEHAVIOR_SECONDS must be positive');
  const key=JSON.stringify(`__archivebox_behavior_${ctx.captureId}`),binding=`__archivebox_fetch_${ctx.captureId.replaceAll('-','')}`;
  const records:RecordRef[]=[],errors:string[]=[],pending=new Set<Promise<void>>();
  await ctx.page.command('Runtime.addBinding',{name:binding,executionContextName:'archivebox-capture'});
  const unsubscribe=await ctx.page.on('Runtime.bindingCalled',event=>{
    if(event.name!==binding)return;
    const {id,url}=JSON.parse(event.payload);
    const task=(async()=>{
      let error:string|undefined;
      try{records.push(await ctx.archive.fetch(url))}catch(cause){error=String(cause);errors.push(`${url}: ${error}`);ctx.log(errors.at(-1)!)}
      await ctx.page.command('Runtime.evaluate',{contextId:event.executionContextId,expression:`self[${key}]?.resolve(${JSON.stringify(id)},${JSON.stringify(error||null)})`,returnByValue:true}).catch(cause=>{if(!/Cannot find context|Execution context was destroyed/.test(String(cause)))throw cause});
    })();
    pending.add(task);void task.finally(()=>pending.delete(task)).catch(error=>errors.push(String(error)));
  });
  const cancel=()=>{void ctx.page.evaluate(`self[${key}]?.stop()`).catch(error=>ctx.log(String(error)))};
  ctx.signal.addEventListener('abort',cancel,{once:true});
  let result:BehaviorResult;
  try{
    result=await ctx.page.evaluate<BehaviorResult>(`(async()=>{
      const manager=self.__bx_behaviors;if(!manager)throw Error('Bundled Browsertrix behaviors are unavailable');
      if(manager.started&&!manager.stopped)throw Error('Another behavior already owns this page');
      manager.behaviors=[];manager.mainBehavior=null;manager.mainBehaviorClass=null;
      const original={x:scrollX,y:scrollY},requests=new Map();let nextId=0;
      const state={behavior:'',behaviors:[],steps:0,logs:[],cancelled:false,
        stop(){this.cancelled=true;manager.stop();},
        resolve(id,error){const request=requests.get(id);if(request){requests.delete(id);error?request.reject(Error(error)):request.resolve(true);}}
      };
      self[${key}]=state;
      try{
        const run=manager.run({autofetch:true,autoplay:true,autoclick:true,autoscroll:true,siteSpecific:true,timeout:${seconds*1000},
          fetchResource:url=>new Promise((resolve,reject)=>{const id=++nextId;requests.set(id,{resolve,reject});self[${JSON.stringify(binding)}](JSON.stringify({id,url}));}),
          log:({data,type})=>{if(state.logs.length<2000)state.logs.push(structuredClone(data));if(type!=='debug'&&data?.behavior)state.steps++;}
        },true);
        state.behavior=manager.mainBehaviorClass?.id||'';
        state.behaviors=manager.behaviors.map(value=>value.id||value.constructor.id);
        await run;
        state.cancelled=state.cancelled||!!manager.timedOut;
        return {behavior:state.behavior,behaviors:state.behaviors,steps:state.steps,logs:state.logs,cancelled:state.cancelled};
      }finally{
        manager.stop();manager.unpause();
        window.scrollTo({left:original.x,top:original.y,behavior:'instant'});
        // Fetch responses may still be draining through the recorder; keep their
        // resolvers until the worker's final flush, then remove this state.
      }
    })()`);
    await Promise.allSettled([...pending]);
  }finally{
    ctx.signal.removeEventListener('abort',cancel);unsubscribe();
    await ctx.page.command('Runtime.removeBinding',{name:binding});
    await ctx.page.evaluate(`delete self[${key}]`);
  }
  records.push(await ctx.archive.addResource({kind:'browsertrix_behaviors',mime:'application/json',body:JSON.stringify({...result,errors})}));
  return {status:ctx.signal.aborted?'killed' as const:errors.length?'failed' as const:'succeeded' as const,
    summary:`Webrecorder ${result.behaviors.join(', ')}: ${result.steps} steps${result.cancelled?' (time budget reached)':''}`,records};
}
