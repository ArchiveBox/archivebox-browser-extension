import type { ArchiveEntry, ArchiveReader } from './reader';
import type { Capture } from '../capture/types';

const owners = new WeakMap<ArchiveReader, Promise<Map<string, string>>>();
const key = (entry: {url:string;ts:number}) => JSON.stringify([entry.url,entry.ts]);

/** Original evidence carries its plugin owner; HTTP resources are references. */
export async function pluginFiles(archive:ArchiveReader,capture:Capture,plugin:string):Promise<ArchiveEntry[]> {
  let ownership=owners.get(archive);
  if(!ownership){
    ownership=(async()=>{
      const result=new Map<string,string>();
      for(const entry of archive.entries.filter(entry=>entry.url.startsWith('urn:'))){
        const {warcHeaders}=await archive.headers(entry);
        const metadata=JSON.parse(warcHeaders['WARC-JSON-Metadata']||'{}');
        if(typeof metadata.plugin==='string')result.set(key(entry),metadata.plugin);
      }
      return result;
    })();
    owners.set(archive,ownership);
  }
  const owned=await ownership;
  const refs=new Set(capture.hooks.filter(hook=>hook.plugin===plugin).flatMap(hook=>(hook.records||[]).map(key)));
  return archive.entries.filter(entry=>owned.get(key(entry))===plugin||refs.has(key(entry)));
}

export function originalFilename(entry:ArchiveEntry){
  if(entry.path)return entry.path.split('/').at(-1)!;
  if(entry.url.startsWith('urn:')){
    const extension=({'image/png':'png','image/jpeg':'jpg','application/pdf':'pdf','application/json':'json','text/html':'html','text/plain':'txt'} as Record<string,string>)[entry.mime.split(';')[0]!]||'bin';
    return `${entry.url.split(':')[1]}-${entry.ts}.${extension}`;
  }
  const url=new URL(entry.url);return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||url.hostname);
}
