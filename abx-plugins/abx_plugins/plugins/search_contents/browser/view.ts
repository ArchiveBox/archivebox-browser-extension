import type {ViewContext,ViewResult} from '@/src/archive/views';
import {readZipMember} from '@/src/archive/zip-members';
import {searchPresentation} from '@/src/ui/search-presentation';
import {originalText} from './text';
import type {SearchIndex,SearchDocument} from './index';
export default async function({archive}:ViewContext):Promise<ViewResult>{
 const entry=archive.artifact('index');if(!entry)throw Error('This capture has no text index');
 const data=await archive.json<SearchIndex>(entry);
 return {title:'Search',summary:'',sections:[],presentation:searchPresentation(data,async(document:SearchDocument)=>{
  const ref=document.ocr||document.ref,entry=archive.find(ref.url,ref.ts);if(!entry)throw Error(`Indexed source is missing: ${ref.url}`);
  const response=await archive.read(entry);
  if(document.ocr)return JSON.parse(new TextDecoder().decode(response.body)).text as string;
  const original=ref.member?.length?await readZipMember(response.body,ref.member):{body:response.body,mime:document.mime};
  return (await originalText(original.body,original.mime,document.title)).text;
 })};
}
