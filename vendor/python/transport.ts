import {postToGetUrl} from 'warcio';
import type {ArchiveReader} from '@/src/archive/reader';
import type {HookContext,RecordRef,FetchMethod} from '@/src/capture/types';
import {matchesRecordedHeaders} from '@/src/capture/request-match';

export type ExtractorResponse={body:Uint8Array;url:string;status:number;headers:Record<string,string>;ref?:RecordRef};
export type ExtractorRequest=(url:string,method:FetchMethod,headers:Record<string,string>,body:Uint8Array|null,timeout:number)=>Promise<ExtractorResponse>;

/** requests/urllib delegate transport framing to their adapter, just as Fetch does. */
export function extractorHeaders(url:string,headers:Record<string,string>,body:Uint8Array|null){
  const normalized=new Headers(headers);
  const length=normalized.get('content-length');
  if(length!==null&&Number(length)!==(body?.byteLength||0))throw Error('Extractor Content-Length does not match request bytes');
  const host=normalized.get('host');
  if(host!==null&&host!==new URL(url).host)throw Error('Extractor Host does not match request URL');
  // These are connection framing, not end-to-end extractor headers. The browser
  // computes its own framing and HTTP/2 connection semantics.
  for(const name of ['host','content-length','connection','keep-alive','transfer-encoding'])normalized.delete(name);
  return Object.fromEntries(normalized);
}

export function createCaptureTransport(ctx:HookContext,limits:{maxBytes:number;maxRequests:number}){
  const records:RecordRef[]=[],stats={bytes:0,requests:0};
  const counted=new Set<string>();
  const rateLimited=new Set<string>();
  const request:ExtractorRequest=async(url,method='GET',headers={},body=null,timeout=30)=>{
    ctx.signal.throwIfAborted();
    const origin=new URL(url).origin;
    if(rateLimited.has(origin))throw Error(`HTTP 429 from ${origin}; further extractor requests stopped`);
    if(++stats.requests>limits.maxRequests)throw Error(`Extractor request limit ${limits.maxRequests} reached`);
    if(stats.bytes>=limits.maxBytes)throw Error(`Extractor byte limit ${limits.maxBytes} reached`);
    const ref=await ctx.archive.fetch(url,{method,headers:extractorHeaders(url,headers,body),...(body?{body}:{}),timeoutMs:timeout*1000,maxBytes:limits.maxBytes-stats.bytes});
    records.push(ref);
    const response=await ctx.archive.read(ref),identity=ref.url+'@'+ref.ts;
    if(!counted.has(identity)){stats.bytes+=response.body.byteLength;counted.add(identity);}
    if(response.status===429)rateLimited.add(origin);
    return {...response,ref,url:String(response.metadata.finalUrl||ref.url)};
  };
  return {request,records,stats};
}

export type RecordedRequest=ExtractorRequest&{failures:string[]};
type Original={url:string;metadata:Record<string,any>;headers:Record<string,string>;read:()=>Promise<ExtractorResponse>};

/** No network fallback: reads resolve through the mounted Webrecorder archive. */
export async function createArchivedTransport(archive:ArchiveReader,refs:Pick<RecordRef,'url'|'ts'>[]):Promise<RecordedRequest>{
  const started=performance.now();
  const originals:Original[]=new Array(refs.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(8,refs.length)},async()=>{while(next<refs.length){
    const index=next++,ref=refs[index]!;
    const entry=archive.find(ref.url,ref.ts);if(!entry)throw Error(`Missing archived extractor record: ${ref.url}`);
    const record=await archive.headers(entry),metadata=JSON.parse(record.warcHeaders['WARC-JSON-Metadata']||'{}');
    originals[index]={url:entry.url,metadata,headers:record.headers,read:async()=>{
      const response=await archive.read(entry);
      return {body:response.body,headers:response.headers,status:entry.status,url:metadata.finalUrl||entry.url};
    }};
  }}));
  performance.measure('archivebox:extractor-headers',{start:started,detail:{references:refs.length}});
  return recordedTransport(originals);
}

/** Completion gate: run the same derivation before sealing, with acquisition
 * disabled. Python may catch network exceptions, so failures are retained too. */
export async function createCapturedTransport(ctx:HookContext,refs:RecordRef[]):Promise<RecordedRequest>{
  const originals:Original[]=[];
  for(const ref of refs){
    ctx.signal.throwIfAborted();
    const record=await ctx.archive.read(ref);
    originals.push({url:ref.url,metadata:record.metadata,headers:record.headers,read:async()=>{
      ctx.signal.throwIfAborted();const response=await ctx.archive.read(ref);
      return {...response,ref,url:String(response.metadata.finalUrl||ref.url)};
    }});
  }
  return recordedTransport(originals);
}

function recordedTransport(originals:Original[]):RecordedRequest{
  type Exchange=Original&{requestHeaders:Record<string,string>|undefined};
  const exchanges=new Map<string,Exchange[]>();
  for(const original of originals){
    const {metadata}=original;
    const key=metadata.fetchKey?JSON.parse(metadata.fetchKey):undefined;
    const method=metadata.requestMethod||key?.[1]||new URL(original.url).searchParams.get('__wb_method')||'GET';
    const exchange={...original,requestHeaders:key?Object.fromEntries(key[2]||[]):undefined};
    const aliases=new Set([method+' '+original.url]);
    if(metadata.requestedUrl){
      const suffix=method!=='GET'&&metadata.finalUrl&&original.url.startsWith(metadata.finalUrl)?original.url.slice(metadata.finalUrl.length):'';
      aliases.add(method+' '+metadata.requestedUrl+suffix);
    }
    for(const alias of aliases){const values=exchanges.get(alias)||[];values.push(exchange);exchanges.set(alias,values);}
  }
  const positions=new Map<string,number>(),failures:string[]=[];
  const request:ExtractorRequest=async(url,method='GET',headers={},body=null)=>{try{
    const normalized=extractorHeaders(url,headers,body);
    const identity={url:new URL(url).href.split('#')[0]!,method,headers:new Headers(normalized),postData:body||new Uint8Array()};
    if(method!=='GET')postToGetUrl(identity);
    const key=method+' '+identity.url,candidates=exchanges.get(key);
    if(!candidates?.length)throw Error(`No captured extractor response: ${method} ${url}`);
    const headerKey=(value:Record<string,string>)=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
    const wanted=headerKey(normalized),exact=candidates.filter(value=>value.requestHeaders&&headerKey(value.requestHeaders)===wanted);
    // The hook's references also include browser-observed exchanges that it
    // consumed during acquisition. Preserve those exact selections; request
    // headers stay in their original WARC request rather than a duplicate map.
    const values=exact.length?exact:candidates.filter(value=>!value.requestHeaders||matchesRecordedHeaders(new Headers(normalized),new Headers(value.requestHeaders),new Headers(value.headers)));
    if(!values.length)throw Error(`Captured extractor request headers differ: ${method} ${url}`);
    const cursorKey=key+' '+wanted,index=positions.get(cursorKey)||0;positions.set(cursorKey,index+1);
    const exchange=values[Math.min(index,values.length-1)]!;
    if(exchange.metadata.requestBodyDigest){
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',(body||new Uint8Array()) as BufferSource)),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(digest!==exchange.metadata.requestBodyDigest)throw Error(`Archived request body differs: ${method} ${url}`);
    }
    return await exchange.read();
  }catch(error){failures.push(String(error));throw error;}};
  return Object.assign(request,{failures});
}
