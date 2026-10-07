import type {ViewContext} from '@/src/archive/views';
import {searchCard} from '@/src/ui/search-presentation';
export default async function({archive}:ViewContext){
 const entry=archive.artifact('index');if(!entry)throw Error('This capture has no text index');
 const {warcHeaders}=await archive.headers(entry),metadata=JSON.parse(warcHeaders['WARC-JSON-Metadata']||'{}');
 const count=typeof metadata.documents==='number'?metadata.documents:(await archive.json(entry)).documents.length;
 return searchCard(count);
}
