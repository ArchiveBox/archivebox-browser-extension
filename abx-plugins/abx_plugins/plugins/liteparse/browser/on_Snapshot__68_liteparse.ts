import {imageSize} from 'image-size';
import {sha256} from 'hash-wasm';
import {openZipMembers} from '@/src/archive/zip-members';
import type {HookContext,HookResult,RecordRef} from '@/src/capture/types';
import type {ParsedDocument} from './parse';

export type SavedDocument={source:RecordRef;name:string;mime:string;size:number;digest:string;width?:number;height?:number;minimumDimension:number};
const parseable=(mime:string)=>/^(application\/pdf|image\/(png|jpeg|webp|bmp|gif|tiff))$/.test(mime);
function sourceMime(name:string,contentType:string){
 const mime=contentType.split(';')[0]!.trim().toLowerCase();if(parseable(mime))return mime;
 const suffix=name.split(/[?#]/)[0]!.split('.').at(-1)?.toLowerCase();
 return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',gif:'image/gif',tif:'image/tiff',tiff:'image/tiff'} as Record<string,string>)[suffix||'']||mime;
}
const zipSource=(name:string,mime:string)=>/^(application\/(zip|x-zip(?:-compressed)?|epub\+zip)|application\/vnd\.(openxmlformats-officedocument|oasis\.opendocument))/.test(mime)||/\.(zip|docx|docm|xlsx|xlsm|pptx|pptm|odt|ods|odp|epub)(?:[?#]|$)/i.test(name);
function sourceName(url:string,headers:Record<string,string>){
 const disposition=headers['content-disposition']||'',encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1],plain=/filename="([^"]+)"|filename=([^;]+)/i.exec(disposition);
 const name=encoded||plain?.[1]||plain?.[2]||new URL(url).pathname.split('/').pop()||'document';
 try{return decodeURIComponent(name.trim())}catch{return name.trim()}
}
export default async function(ctx:HookContext):Promise<HookResult>{
 const minimum=Math.max(0,Number(ctx.config.LITEPARSE_MIN_IMAGE_DIMENSION??128)),limit=Math.max(0,Number(ctx.config.LITEPARSE_MAX_SOURCES??100));
 const seen=new Set<string>(),archives=new Set<string>(),sources:SavedDocument[]=[],records:RecordRef[]=[],failures:string[]=[];
 let tiny=0,empty=0,duplicates=0,expandedBytes=0;
 async function consider(source:RecordRef,name:string,mime:string,body:Uint8Array,knownDigest?:string){
  ctx.signal.throwIfAborted();if(!body.length){empty++;return}
  const digest=knownDigest?.replace(/^sha-256:/i,'sha256:')||'sha256:'+await sha256(body);
  if(zipSource(name,mime)){
   if(archives.has(digest))return;archives.add(digest);
   if((source.member?.length||0)>=8)throw Error(`ZIP nesting exceeds 8 levels: ${name}`);
   const archive=await openZipMembers(body,ctx.signal);
   try{
    for(const member of archive.members){
     ctx.signal.throwIfAborted();const childMime=sourceMime(member.path,member.mime);
     if(!parseable(childMime)&&!zipSource(member.path,member.mime))continue;
     if(childMime.startsWith('image/')&&ctx.config.LITEPARSE_OCR_ENABLED===false)continue;
     if(member.size>256*1024*1024||expandedBytes+member.size>1024*1024*1024)throw Error(`Embedded OCR input exceeds expansion budget: ${member.path}`);
     expandedBytes+=member.size;
     await consider({...source,member:[...(source.member||[]),member.path]},member.path.split('/').pop()||member.path,childMime,await member.read());
    }
   }finally{await archive.close()}
   return;
  }
  if(!parseable(mime)||mime.startsWith('image/')&&ctx.config.LITEPARSE_OCR_ENABLED===false)return;
  if(seen.has(digest)){duplicates++;return}seen.add(digest);
  let dimensions:{width:number;height:number}|undefined;
  if(mime.startsWith('image/'))try{const {width,height}=imageSize(body);if(width>0&&height>0)dimensions={width,height}}catch{/* Unknown headers remain eligible, matching canonical source discovery. */}
  if(dimensions&&dimensions.width<minimum&&dimensions.height<minimum){tiny++;return}
  sources.push({source,name,mime,size:body.length,digest,...dimensions,minimumDimension:minimum});
 }
 for(const entry of await ctx.archive.entries()){
  ctx.signal.throwIfAborted();
  if(entry.method==='HEAD'||!/^https?:/i.test(entry.url)||entry.status<200||entry.status>=300||entry.status===206)continue;
  const mime=sourceMime(entry.url,entry.mime);if(!parseable(mime)&&!zipSource(entry.url,mime)&&mime!=='application/octet-stream')continue;
  if(mime.startsWith('image/')&&ctx.config.LITEPARSE_OCR_ENABLED===false)continue;
  const digest=entry.digest?.replace(/^sha-256:/i,'sha256:');if(digest&&seen.has(digest)){duplicates++;continue}
  try{
   const response=await ctx.archive.read(entry);
   const name=sourceName(entry.url,response.headers),detected=new TextDecoder().decode(response.body.subarray(0,5))==='%PDF-'?'application/pdf':sourceMime(name,response.mime);
   await consider({url:entry.url,ts:entry.ts,captureId:ctx.captureId},name,detected,response.body,digest);
  }catch(error){if(ctx.signal.aborted)throw error;const failure=`${entry.url}: ${String(error)}`;failures.push(failure);ctx.log(failure)}
 }
 sources.sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name));
 const selected=limit?sources.slice(0,limit):sources,omitted=sources.length-selected.length;
 ctx.log(`LiteParse: ${selected.length} original sources; ${duplicates} duplicate bodies, ${tiny} small images, ${empty} empty responses, ${omitted} beyond source limit.`);
 for(const [index,document]of selected.entries()){
  if(ctx.signal.aborted)return {status:'killed',records,summary:`Stopped after ${records.length} of ${selected.length} documents.`};
  ctx.log(`Parsing ${index+1}/${selected.length}: ${document.name} (${document.size} bytes)`);
  try{
   const parsed=await ctx.parseDocument(document.source) as ParsedDocument;
   const record=await ctx.archive.addResource({kind:'ocr',mime:'application/json',body:JSON.stringify(parsed),sourceUrl:document.source.url,metadata:{document}});records.push(record);
   if(parsed.pageErrors.length||parsed.imageErrorCount)failures.push(`${document.name}: ${parsed.pageErrors.length} page errors, ${parsed.imageErrorCount} image errors`);
  }catch(error){
   if(ctx.signal.aborted)return {status:'killed',records,summary:`Stopped after ${records.length} of ${selected.length} documents.`};
   const failure=`${document.name}: ${String(error)}`;failures.push(failure);ctx.log(failure);
  }
 }
 return {status:failures.length?'failed':records.length?'succeeded':'noresults',records,summary:`${records.length} of ${selected.length} documents parsed; ${omitted} beyond source limit.${failures.length?' '+failures.join('; '):''}`};
}
