import type {ViewContext,ViewResult} from '@/src/archive/views';
import {originalFile} from './source';
export default async function(context:ViewContext):Promise<ViewResult>{
 const original=await originalFile(context);
 if(!original)return {title:'Original file',summary:'No successful non-HTML main response is present in this archive.',sections:[]};
 const {entry,headers,url}=original;
 return {title:'Original file',summary:url+' · '+entry.mime,sections:[{type:'resource',title:'Archived file',entry},{type:'table',title:'Response headers',columns:['Header','Value'],rows:Object.entries(headers)}]};
}
