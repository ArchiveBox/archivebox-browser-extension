import type {ArchiveReader} from './reader';

const cacheName='archivebox-derived-json-v1';
const prefix='https://archivebox.invalid/derived/'; // Cache key only; never fetched.
const maxBytes=64*1024*1024,maxEntries=32;

/** Disposable view-time JSON, separate from the archive and response storage.
 * The manifest covers WARC/native hashes and hook configuration. Code/runtime
 * revisions and inputs also participate, so another capture or build cannot
 * reuse a stale extraction. Storage denial/eviction simply means recomputing. */
export async function cachedDerivedJSON<T>(archive:ArchiveReader,plugin:string,inputs:unknown,derive:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();
  const started=performance.now();
  const identity=JSON.stringify([archive.manifest,plugin,inputs]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const key=`${prefix}${archive.captureId}/${digest}`;
  let cache:Cache|undefined;
  try{
    cache=await caches.open(cacheName);
    const cached=await cache.match(key);
    if(cached){
      const result=await cached.json() as T;signal?.throwIfAborted();
      performance.measure('archivebox:derivation-cache',{start:started,detail:{plugin,hit:true}});
      return result;
    }
  }catch{signal?.throwIfAborted()}
  performance.measure('archivebox:derivation-cache',{start:started,detail:{plugin,hit:false}});
  const result=await derive();
  signal?.throwIfAborted();
  if(cache){
    const body=new Blob([JSON.stringify(result)],{type:'application/json'});
    if(body.size<=maxBytes){try{
      await cache.put(key,new Response(body,{headers:{'Content-Length':String(body.size)}}));
      const keys=await cache.keys();let bytes=0,count=0;
      for(const request of [...keys].reverse()){
        const response=await cache.match(request);bytes+=Number(response?.headers.get('Content-Length')||0);
        if(++count>maxEntries||bytes>maxBytes)await cache.delete(request);
      }
    }catch{/* A cache write must not prevent showing a successful derivation. */}}
  }
  return result;
}

export async function deleteDerivedCache(captureId:string){
  if(!await caches.has(cacheName))return;
  const cache=await caches.open(cacheName);
  for(const key of await cache.keys())if(key.url.startsWith(`${prefix}${captureId}/`))await cache.delete(key);
}
