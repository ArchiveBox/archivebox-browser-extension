import type {HookContext,RecordRef} from '@/src/capture/types';

export default async function(ctx:HookContext){
 const {cssContentSize,cssLayoutViewport}=await ctx.page.command('Page.getLayoutMetrics');
 const {devicePixelRatio,url}=await ctx.page.evaluate<{devicePixelRatio:number;url:string}>('({devicePixelRatio,url:location.href})');
 // A verified native download leaves the tab blank; its original bytes are
 // archived, but there is no rendered HTTP document to photograph.
 if(!/^https?:/.test(url))return {status:'noresults' as const,records:[],summary:'No rendered HTTP document for screenshots'};
 const fullPage={x:Math.floor(cssContentSize.x),y:Math.floor(cssContentSize.y),width:Math.ceil(cssContentSize.x+cssContentSize.width)-Math.floor(cssContentSize.x),height:Math.ceil(cssContentSize.y+cssContentSize.height)-Math.floor(cssContentSize.y)};
 if(![fullPage.x,fullPage.y,fullPage.width,fullPage.height,devicePixelRatio].every(Number.isFinite)||fullPage.width<=0||fullPage.height<=0||devicePixelRatio<=0)throw Error('Invalid page screenshot dimensions');
 const ratio=Math.max(1,devicePixelRatio),edge=Math.max(1,Math.floor(8192/ratio));
 const tileWidth=Math.min(fullPage.width,cssLayoutViewport.clientWidth,edge),tileHeight=Math.min(fullPage.height,cssLayoutViewport.clientHeight,edge,Math.max(1,Math.floor(16*1024*1024/(tileWidth*ratio*ratio))));
 const pageLimit=Math.max(1,Math.floor(Number(ctx.config.INFINISCROLL_SCROLL_LIMIT??10)));
 if(!Number.isFinite(pageLimit))throw Error('Invalid screenshot page limit');
 const capturedArea={...fullPage,width:tileWidth,height:Math.min(fullPage.height,tileHeight*pageLimit)};
 const count=Math.ceil(capturedArea.height/tileHeight),records:RecordRef[]=[];
 let bytes=0,tiles=0;
 const save=async(format:'jpeg'|'png',clip:{x:number;y:number;width:number;height:number;scale:number},index:number)=>{
  ctx.signal.throwIfAborted();const capturedAt=Date.now();
  // Preserve the real viewport when no off-screen pixels are needed. Chrome's
  // temporary viewport resize otherwise changes canvas-editor page geometry.
  const captureBeyondViewport=clip.x<cssLayoutViewport.pageX||clip.y<cssLayoutViewport.pageY||clip.x+clip.width>cssLayoutViewport.pageX+cssLayoutViewport.clientWidth||clip.y+clip.height>cssLayoutViewport.pageY+cssLayoutViewport.clientHeight;
  const {data}=await ctx.page.command<{data:string}>('Page.captureScreenshot',{format,...(format==='jpeg'?{quality:75}:{}),captureBeyondViewport,clip});
  const body=Uint8Array.from(atob(data),char=>char.charCodeAt(0));
  let pixelWidth:number|undefined,pixelHeight:number|undefined;
  if(format==='png'){
   const png=new DataView(body.buffer,body.byteOffset,body.byteLength);
   if(body.length<24||png.getUint32(0)!==0x89504e47||png.getUint32(4)!==0x0d0a1a0a)throw Error('Browser returned an invalid PNG screenshot');
   pixelWidth=png.getUint32(16);pixelHeight=png.getUint32(20);if(!pixelWidth||!pixelHeight)throw Error('Browser returned an empty screenshot');
  }else if(body[0]!==0xff||body[1]!==0xd8)throw Error('Browser returned an invalid JPEG screenshot');
  records.push(await ctx.archive.addResource({kind:format==='jpeg'?'screenshot':'fullPage',mime:'image/'+format,body,sourceUrl:url,metadata:{screenshot:{version:1,sourceUrl:url,fullPage,capturedArea,devicePixelRatio,tile:{index,count:format==='jpeg'?1:count,...clip,pixelWidth,pixelHeight},capturedAt}}}));
  bytes+=body.length;
 };
 try{
  await save('jpeg',{...capturedArea,height:Math.min(capturedArea.height,12000),scale:1},0);
  for(let y=0;y<capturedArea.height;y+=tileHeight){
   await save('png',{x:capturedArea.x,y:capturedArea.y+y,width:capturedArea.width,height:Math.min(tileHeight,capturedArea.height-y),scale:1},tiles);tiles++;
  }
  ctx.signal.throwIfAborted();const final=(await ctx.page.command('Page.getLayoutMetrics')).cssContentSize;
  if(final.x!==cssContentSize.x||final.y!==cssContentSize.y||final.width!==cssContentSize.width||final.height!==cssContentSize.height)throw Error('Page dimensions changed during screenshot capture from '+JSON.stringify(cssContentSize)+' to '+JSON.stringify(final));
  return {records,summary:capturedArea.width+' × '+capturedArea.height+' CSS pixels; JPEG preview and '+count+' full-resolution PNG pages (limit '+pageLimit+'); '+bytes+' bytes'};
 }catch(error){return {status:ctx.signal.aborted?'killed' as const:'failed' as const,records,summary:'Incomplete screenshot: '+tiles+'/'+count+' PNG tiles saved. '+String(error)}}
}
