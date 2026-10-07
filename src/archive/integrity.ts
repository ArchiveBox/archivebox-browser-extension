import type {ArchiveReader} from './reader';
const sha256=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');


/** Storage-backed hash hierarchy. Plugins consume this model without inspecting
 * WARC paths, ZIP positions, ranges or transfer sizes. */
export async function integrityTree(archive:ArchiveReader,{includeRecords=true}:{includeRecords?:boolean}={}){
  // WACZ package members are the actual files in this archive. Their manifest
  // hashes refer to these exact bytes, not invented exported plugin paths.
  const files=archive.manifest.resources.map((resource:any)=>({path:resource.path,hash:String(resource.hash).replace(/^sha-?256:/,''),size:resource.bytes})).sort((a:any,b:any)=>a.path.localeCompare(b.path));
  // CDX payload digests expose every original response/evidence body without
  // decompressing whole WARC members merely to draw a thumbnail.
  const warc_records:Record<string,{files:unknown[];root_hash:string;tree_levels:string[][]}>={};
  for(const file of includeRecords?files:[]){
    const records=archive.entries.filter(entry=>!entry.native&&(entry.filename.startsWith('archive/')?entry.filename:`archive/${entry.filename}`)===file.path).map(entry=>{
      const url=new URL(entry.url),parts=url.protocol==='urn:'?[entry.url.split(':')[1]!,entry.url]:[url.host,...url.pathname.split('/').filter(Boolean),url.search||''];
      return {path:parts.filter(Boolean).map(part=>encodeURIComponent(part)).join('/')+`/${entry.timestamp}-${entry.offset}`,url:entry.url,timestamp:entry.timestamp,offset:entry.offset,stored_bytes:entry.length,hash:entry.digest.replace(/^sha-?256:/,''),algorithm:entry.digest.split(':')[0],size:null};
    }).sort((a,b)=>a.path.localeCompare(b.path));
    if(!records.length)continue;
    const levels=[records.map(record=>record.hash)];
    while(levels.at(-1)!.length>1){const level=levels.at(-1)!,next:string[]=[];for(let i=0;i<level.length;i+=2)next.push(await sha256(level[i]!+(level[i+1]||level[i])));levels.push(next)}
    warc_records[file.path]={files:records,root_hash:levels.at(-1)![0]!,tree_levels:levels};
  }
  const tree_levels:string[][]=[files.map((file:any)=>file.hash)];
  while(tree_levels.at(-1)!.length>1){const level=tree_levels.at(-1)!,next:string[]=[];for(let i=0;i<level.length;i+=2)next.push(await sha256(level[i]!+(level[i+1]||level[i])));tree_levels.push(next)}
  const data={files,warc_records,root_hash:tree_levels.at(-1)![0]||await sha256(''),tree_levels,metadata:{timestamp:archive.manifest.created,file_count:files.length,record_count:archive.entries.length,total_size:files.reduce((total:number,file:any)=>total+file.size,0),tree_depth:tree_levels.length}};
  return data;
}
