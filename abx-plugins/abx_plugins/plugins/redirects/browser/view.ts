import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '../../../../../vendor/archivebox/plugins/redirects/full.html?raw';
import {initializeRedirects} from '@/src/ui/redirects-template';
export default async function({archive,capture,url,signal}:ViewContext):Promise<ViewResult>{
  const records:Record<string,any>[]=[{type:'initial',to_url:capture?.url||url}];
  let current=capture?.url||url;
  // Follow recorded page redirects, excluding unrelated subresource redirects.
  const candidates=archive.entries.filter(entry=>/^https?:/.test(entry.url)&&entry.status>=300&&entry.status<400).sort((a,b)=>a.ts-b.ts);
  for(const entry of candidates){
    if(entry.url!==current)continue;signal?.throwIfAborted();
    const {headers}=await archive.headers(entry),location=headers.location;if(!location)continue;
    let destination=location;try{destination=new URL(location,entry.url).href}catch{}
    records.push({type:'http',from_url:entry.url,to_url:destination,status:entry.status,content:location,timestamp:new Date(entry.ts).toISOString()});current=destination;
  }
  return {title:'Redirects',summary:'',sections:[],presentation:{type:'canonical',plugin:'redirects',title:'Redirects',template,data:records,format:'jsonl',initialize:initializeRedirects}};
}
