import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/seo/full.html?raw';
import {initializeSEO} from '@/src/ui/seo-template';

export default async function({archive,url,capture}:ViewContext):Promise<ViewResult>{
  const doc=await archive.dom();
  // Canonical seo/on_Snapshot__38_seo.js JSON model, derived from preserved DOM.
  const data:Record<string,string>={url,title:doc.title||''};
  for(const tag of doc.querySelectorAll('meta')){
    const key=tag.getAttribute('name')||tag.getAttribute('property'),content=tag.getAttribute('content');
    if(key&&content)data[key]=content;
  }
  const canonical=doc.querySelector('link[rel="canonical"]');if(canonical)data.canonical=canonical.getAttribute('href')||'';
  if(doc.documentElement.lang)data.language=doc.documentElement.lang;
  const favicon=capture?.hooks.find(hook=>hook.plugin==='favicon')?.records?.map(ref=>archive.find(ref.url,ref.ts)).find(entry=>entry?.mime.startsWith('image/'));
  return {title:'SEO',summary:'',sections:[],presentation:{type:'canonical',plugin:'seo',title:'SEO',template,data,
    initialize:(document,data,options)=>initializeSEO(document,data,options,favicon?.url)}};
}
