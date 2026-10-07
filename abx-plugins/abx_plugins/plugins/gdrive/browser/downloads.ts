import type {HookContext,BrowserDownload,RecordRef} from '@/src/capture/types';
import type {ViewContext} from '@/src/archive/views';
import {openZipMembers,memberMime} from '@/src/archive/zip-members';
export type CloudFile={path:string;filename:string;format:string;size:number;sha256:string;mime:string;ref:RecordRef};
export type CloudFiles={title:string;files:CloudFile[];downloads:BrowserDownload[]};
export function cloudEvidence(context:ViewContext,plugin:string){
  const hook=context.capture?.hooks.find(hook=>hook.plugin===plugin)||context.archive.metadata?.plugins?.find((item:{id:string})=>item.id===plugin)?.hooks?.[0];
  return hook?.data as CloudFiles|undefined;
}
export async function inventoryDownloads(ctx:HookContext,downloads:BrowserDownload[],requireZip=false):Promise<CloudFiles>{
  const files:CloudFile[]=[],seen=new Set<string>();
  const save=async(body:Uint8Array,filename:string,ref:RecordRef)=>{
    const path=filename.replaceAll('\\','/');
    if(!path||path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.includes('\0')||path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(path))throw Error(`Unsafe or duplicate archive filename: ${filename}`);
    seen.add(path);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',body as BufferSource));
    files.push({path:'files/'+path,filename:path,format:path.split('.').pop()?.toLowerCase()||'file',size:body.byteLength,sha256:[...hash].map(byte=>byte.toString(16).padStart(2,'0')).join(''),mime:memberMime(path),ref});
  };
  for(const download of downloads){
    ctx.signal.throwIfAborted();const resource=await ctx.archive.read(download.ref);
    const zip=download.filename.toLowerCase().endsWith('.zip');if(requireZip&&!zip)throw Error('Expected a folder ZIP download');
    if(requireZip){const archive=await openZipMembers(resource.body,ctx.signal);try{for(const member of archive.members)await save(await member.read(),member.path,{...download.ref,member:[member.path]})}finally{await archive.close()}}
    else await save(resource.body,download.filename,download.ref);
  }
  if(!files.length)throw Error('Provider returned no files');
  return {title:await ctx.page.evaluate<string>('document.title'),files,downloads};
}
export async function waitElement(ctx:HookContext,expression:string,deadline:number){
  while(Date.now()<deadline){
    ctx.signal.throwIfAborted();const point=await ctx.page.evaluate<{x:number;y:number}|null>(`(async()=>{const element=(${expression});if(!element||!element.getClientRects().length||getComputedStyle(element).visibility==='hidden'||element.disabled)return null;let rect=element.getBoundingClientRect();if(rect.top<0||rect.left<0||rect.bottom>innerHeight||rect.right>innerWidth){element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});rect=element.getBoundingClientRect()}await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const next=element.getBoundingClientRect();if(['x','y','width','height'].some(key=>rect[key]!==next[key]))return null;return {x:next.x+next.width/2,y:next.y+next.height/2}})()`);
    if(point)return point;await ctx.sleep(100);
  }
  throw Error('Provider download control unavailable before timeout');
}
export async function click(ctx:HookContext,expression:string,deadline:number,button='left'){
  const point=await waitElement(ctx,expression,deadline);
  await ctx.page.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await ctx.page.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,clickCount:1});
  await ctx.page.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button,clickCount:1});
}
export const element=(selector:string)=>`document.querySelector(${JSON.stringify(selector)})`;
