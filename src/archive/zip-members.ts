import {ZipReader,Uint8ArrayReader,Uint8ArrayWriter} from '@zip.js/zip.js';

export type ZipMember={path:string;size:number;mime:string;read:()=>Promise<Uint8Array>};
export function memberMime(path:string){
  const extension=path.split('.').pop()?.toLowerCase()||'';
  if(/^(LICENSE|COPYING|NOTICE|README|Makefile|Dockerfile|\.gitignore|\.gitattributes)$/i.test(path.split('/').pop()||''))return 'text/plain';
  return ({sh:'text/x-shellscript',py:'text/x-python',js:'text/javascript',ts:'text/typescript',css:'text/css',yml:'application/yaml',yaml:'application/yaml',toml:'application/toml',jsonl:'application/x-ndjson',log:'text/plain',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',svg:'image/svg+xml',txt:'text/plain',md:'text/markdown',csv:'text/csv',tsv:'text/tab-separated-values',json:'application/json',html:'text/html',htm:'text/html',xml:'application/xml',zip:'application/zip',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'} as Record<string,string>)[extension]||'application/octet-stream';
}
/** Provider downloads stay verbatim in WARC. These member bytes are transient;
 * zip.js verifies CRCs and preserves nested ZIPs as ordinary original files. */
export async function openZipMembers(body:Uint8Array,signal?:AbortSignal){
  const reader=new ZipReader(new Uint8ArrayReader(body),{checkSignature:true,useWebWorkers:false});
  try{
    signal?.throwIfAborted();
    // Dropbox includes an inert '/' directory marker, explicitly accepted by
    // canonical unpack_downloads.py. Validate names below, before any read.
    const entries=await reader.getEntries({filenameValidation:'tolerant'}),seen=new Set<string>(),members:ZipMember[]=[];
    for(const entry of entries){
      const path=entry.filename.replaceAll('\\','/');
      if(entry.directory&&path==='/')continue;
      if(!path||path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.includes('\0')||path.split('/').some(segment=>segment==='..'))throw Error(`Unsafe archive filename: ${entry.filename}`);
      if(entry.symlink)throw Error(`Archive contains a symlink: ${entry.filename}`);
      if(entry.directory)continue;
      if(path.split('/').some(segment=>!segment||segment==='.')||seen.has(path))throw Error(`Ambiguous archive filename: ${entry.filename}`);
      seen.add(path);
      members.push({path,size:entry.uncompressedSize,mime:memberMime(path),read:async()=>{signal?.throwIfAborted();return entry.getData(new Uint8ArrayWriter(),{checkSignature:true,signal})}});
    }
    return {members,close:()=>reader.close()};
  }catch(error){await reader.close();throw error}
}
export async function readZipMember(body:Uint8Array,member:string[],signal?:AbortSignal):Promise<{body:Uint8Array;mime:string}>{
  if(!member.length)throw Error('ZIP member path is empty');
  let mime='application/zip';
  for(const path of member){
    const archive=await openZipMembers(body,signal);
    try{const entry=archive.members.find(entry=>entry.path===path);if(!entry)throw Error(`Archived ZIP member not found: ${path}`);body=await entry.read();mime=entry.mime}
    finally{await archive.close()}
  }
  return {body,mime};
}
