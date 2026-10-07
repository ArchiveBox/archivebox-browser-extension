import type {ViewContext,ViewResult} from '@/src/archive/views';
import {recordURL} from '@/src/archive/replay';
import template from '@/vendor/archivebox/plugins/googledocs/full.html?raw';
import {exportEvidence} from './model';
import {initializeGoogleDocs} from './template';

export default async function(context:ViewContext):Promise<ViewResult>{
  const {archive}=context,evidence=exportEvidence(context);
  if(!evidence)throw Error('No Google document exports recorded');
  const entries=new Map(evidence.exports.map(item=>[item.path,archive.find(item.ref.url,item.ref.ts)]));
  const data={...evidence,exports:await Promise.all(evidence.exports.map(async item=>{
    const entry=entries.get(item.path);if(!entry)throw Error(`Missing recorded export: ${item.path}`);
    const headers=await archive.headers(entry);
    return {...item,size:Number(headers.headers['content-length']||0),digest:entry.digest};
  }))};
  return {title:'Google Docs',summary:'',sections:[],presentation:{type:'canonical',plugin:'googledocs',title:'Google Docs',template,data,filename:'exports.json',nativePDF:true,
    async initialize(document,data,options){
      const urls=new Map<string,string>();
      const entry=(item:{path:string})=>{const value=entries.get(item.path);if(!value)throw Error(`Missing recorded export: ${item.path}`);return value};
      try{
        await initializeGoogleDocs(document,data,{rawURL:options.rawURL,url:item=>recordURL(archive,entry(item)),download:async item=>{
          // Browser downloads bypass the replay service worker. Materialize only
          // the clicked original response, as with the gallery/media viewers.
          const resource=entry(item),{body}=await archive.read(resource);
          const href=URL.createObjectURL(new Blob([body as BlobPart],{type:resource.mime}));
          const link=globalThis.document.createElement('a');link.href=href;link.download=item.path;link.click();
          setTimeout(()=>URL.revokeObjectURL(href),60000);
        },pdf:async item=>{
          let url=urls.get(item.path);
          if(!url){const {body}=await archive.read(entry(item));url=URL.createObjectURL(new Blob([body as BlobPart],{type:'application/pdf'}));urls.set(item.path,url)}
          return url;
        }});
      }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));throw error}
      return ()=>urls.forEach(url=>URL.revokeObjectURL(url));
    },
  }};
}
