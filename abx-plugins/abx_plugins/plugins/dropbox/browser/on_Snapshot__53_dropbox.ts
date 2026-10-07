import type {HookContext} from '@/src/capture/types';
import {click,element,waitElement,inventoryDownloads} from '../../gdrive/browser/downloads';
export function sharePath(value:string){
  const url=new URL(value);if(url.protocol!=='https:'||!['www.dropbox.com','dropbox.com'].includes(url.host)||url.username||url.password)return null;
  if(!/^\/(?:scl\/(?:fi|fo)|s|sh)\/[\w-]+\//.test(url.pathname))return null;
  const parts=url.pathname.split('/').filter(Boolean),modernFolder=parts[0]==='scl'&&parts[1]==='fo';
  if(modernFolder||parts[0]==='sh'){const root=modernFolder?`fo:${parts[2]}`:`sh:${parts[1]}`,child=parts.slice(modernFolder?4:3).map(decodeURIComponent);if(url.searchParams.has('preview'))child.push(url.searchParams.get('preview')!);return `${root}/${child.join('/')}`}
  return url.pathname;
}
export default async function(ctx:HookContext){
  if(ctx.config.DROPBOX_ENABLED===false)return{status:'skipped' as const,summary:'DROPBOX_ENABLED=False'};
  const original=sharePath(ctx.url);if(!original)return{status:'noresults' as const,summary:'Not a Dropbox share URL'};
  if(['dl','raw'].some(key=>new URL(ctx.url).searchParams.get(key)==='1'))return{status:'noresults' as const,summary:'Direct Dropbox downloads are captured by staticfile'};
  if(sharePath(await ctx.page.evaluate<string>('location.href'))!==original)throw Error('Chrome tab is not on the requested Dropbox share (login may be required)');
  const deadline=Date.now()+Number(ctx.config.DROPBOX_TIMEOUT??120)*1000,token=await ctx.archive.beginDownloads();
  try{
    await ctx.page.evaluate('document.documentElement.dataset.abxDownloadActive="true"');await ctx.page.command('Page.bringToFront');
    await waitElement(ctx,element('[data-testid="action-bar-download-button"], #fvsdk-mount-point button[aria-label="Download"]'),deadline);
    const folderDownload=await ctx.page.evaluate<boolean>(`!!${element('[data-testid="action-bar-download-button"]')}`);
    await click(ctx,element('[data-testid="action-bar-download-button"], #fvsdk-mount-point button[aria-label="Download"]'),deadline);ctx.log('Opened Dropbox Download action');
    const completed=ctx.archive.finishDownloads(token,deadline-Date.now());
    const dialog=element(':is(#folder-preview-modal, #shared-link-download-signup-modal) .dig-Modal-footer button');
    const first=await Promise.race([completed.then(downloads=>({downloads})),waitElement(ctx,dialog,deadline).then(()=>({downloads:undefined}))]);
    if(!first.downloads)await click(ctx,dialog,deadline);
    ctx.log('Dropbox is preparing the download');const downloads=first.downloads||await completed;
    const data=await inventoryDownloads(ctx,downloads,folderDownload);return{summary:`${data.files.length} files`,records:downloads.map(item=>item.ref),data};
  }finally{await ctx.archive.cancelDownloads(token);await ctx.page.evaluate('delete document.documentElement.dataset.abxDownloadActive').catch(()=>{})}
}
