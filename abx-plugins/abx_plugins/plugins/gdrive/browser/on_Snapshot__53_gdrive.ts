import type {HookContext} from '@/src/capture/types';
import {click,element,waitElement,inventoryDownloads} from './downloads';
export function folderId(value:string){
  const url=new URL(value);if(url.protocol!=='https:'||url.host!=='drive.google.com'||url.username||url.password)return null;
  const id=url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)(?:\/|$)/)?.[1]||(url.pathname==='/folderview'?url.searchParams.get('id'):null);
  return id&&/^[\w-]+$/.test(id)?id:null;
}
/** Canonical Drive folder Download action. Recorder owns its single response. */
export default async function(ctx:HookContext){
  if(ctx.config.GDRIVE_ENABLED===false)return{status:'skipped' as const,summary:'GDRIVE_ENABLED=False'};
  const id=folderId(ctx.url);if(!id)return{status:'noresults' as const,summary:'Not a Google Drive folder URL'};
  const timeoutMs=Number(ctx.config.GDRIVE_TIMEOUT??120)*1000,deadline=Date.now()+timeoutMs;
  if(folderId(await ctx.page.evaluate<string>('location.href'))!==id)throw Error('Chrome tab is not on the requested Drive folder (login may be required)');
  const token=await ctx.archive.beginDownloads();
  try{
    await ctx.page.evaluate('document.documentElement.dataset.abxDownloadActive="true"');await ctx.page.command('Page.bringToFront');
    const button='[guidedhelpid="folder_path_button"] [role="button"]';
    await waitElement(ctx,element(`${button}, [data-id="${id}"][role="link"]`),deadline);
    if(await ctx.page.evaluate<boolean>(`!!(${element(button)})`)){ctx.log('Opening Drive folder menu');await click(ctx,element(button),deadline)}
    else{
      ctx.log('Selecting folder contents in Drive');const first=element('[role="row"][data-id]');await click(ctx,first,deadline);
      const modifiers=await ctx.page.evaluate<number>('/Mac/.test(navigator.platform)?4:2');
      await ctx.page.command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
      await ctx.page.command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
      await click(ctx,first,deadline,'right');
    }
    ctx.log('Opening Drive Download action');
    await click(ctx,`[...document.querySelectorAll('[role="menuitem"]')].find(el=>(el.getAttribute('aria-label')||el.textContent||'').trim()==='Download')`,deadline);
    ctx.log('Drive is preparing the folder ZIP');
    await waitElement(ctx,element('[aria-label="Cancel download"]'),deadline);
    while(await ctx.page.evaluate<boolean>(`[...document.querySelectorAll('[aria-label="Cancel download"]')].some(el=>el.getClientRects().length)`)){if(Date.now()>=deadline)throw Error('Drive ZIP preparation timeout exceeded');await ctx.sleep(100)}
    const downloads=await ctx.archive.finishDownloads(token,deadline-Date.now());
    const data=await inventoryDownloads(ctx,downloads,true);return{summary:`${data.files.length} files`,records:downloads.map(item=>item.ref),data};
  }finally{await ctx.archive.cancelDownloads(token);await ctx.page.evaluate('delete document.documentElement.dataset.abxDownloadActive').catch(()=>{})}
}
