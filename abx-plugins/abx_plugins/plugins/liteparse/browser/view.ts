import type {ViewContext,ViewResult} from '@/src/archive/views';
import type {ArchiveEntry,ArchiveReader} from '@/src/archive/reader';
import type {ParsedDocument} from './parse';
import type {SavedDocument} from './on_Snapshot__68_liteparse';
import {readZipMember} from '@/src/archive/zip-members';

export type DocumentSource=SavedDocument&{entry:ArchiveEntry;excluded?:boolean;original?:(signal?:AbortSignal)=>Promise<{body:Uint8Array;mime:string}>;peek:()=>ParsedDocument|undefined;subscribe:(listener:()=>void)=>()=>void;load:(signal:AbortSignal)=>Promise<ParsedDocument>};
const cache=new WeakMap<ArchiveReader,Promise<ViewResult>>();
export default function({archive}:ViewContext):Promise<ViewResult>{
 let result=cache.get(archive);if(!result){result=documents(archive);cache.set(archive,result);result.catch(()=>cache.delete(archive))}return result;
}
async function documents(archive:ArchiveReader):Promise<ViewResult>{
 const documents:DocumentSource[]=[];
 for(const saved of archive.entries.filter(entry=>entry.url.startsWith('urn:ocr:'))){
  const {warcHeaders}=await archive.headers(saved),metadata=JSON.parse(warcHeaders['WARC-JSON-Metadata']||'{}');
  const document=metadata.document as SavedDocument|undefined;
  if(!document?.source)throw Error('Saved OCR result is missing its original source reference');
  const entry=archive.find(document.source.url,document.source.ts);if(!entry)throw Error(`Saved OCR source is missing: ${document.source.url}`);
  const parsed=await archive.json<ParsedDocument>(saved);
  const original=document.source.member?async(signal?:AbortSignal)=>readZipMember((await archive.read(entry)).body,document.source.member!,signal):undefined;
  documents.push({...document,entry,original,peek:()=>parsed,subscribe:()=>()=>{},load:async signal=>{signal.throwIfAborted();return parsed}});
 }
 documents.sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name));
 return {title:'LiteParse',summary:`${documents.length} saved document parses.`,sections:[],presentation:{type:'documents',documents}};
}
