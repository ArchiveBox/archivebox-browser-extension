import type {ViewContext,ViewResult} from '@/src/archive/views';
import {recordURL} from '@/src/archive/replay';
import {readZipMember,openZipMembers} from '@/src/archive/zip-members';
import {cloudEvidence,type CloudFile,type CloudFiles} from './downloads';
import {initializeCloudFiles} from './template';
import {initializeCloudFilesCard} from './card-template';
export function cloudView(context:ViewContext,plugin:string,template:string):ViewResult{
  const {archive}=context,data=cloudEvidence(context,plugin);if(!data?.files.length)throw Error('No provider download recorded');
  return {title:plugin==='gdrive'?'Google Drive':'Dropbox',summary:'',sections:[],presentation:{type:'canonical',plugin,title:data.title,template,data,filename:'downloads.json',nativePDF:true,
    async initialize(document,data:CloudFiles){
      const urls=new Map<string,string>(),cleanups:(()=>void)[]=[];
      const key=(file:CloudFile)=>JSON.stringify(file.ref);
      const read=async(file:CloudFile)=>{const entry=archive.find(file.ref.url,file.ref.ts);if(!entry)throw Error(`Missing original download: ${file.filename}`);const original=await archive.read(entry);return file.ref.member?.length?(await readZipMember(original.body,file.ref.member,context.signal)).body:original.body};
      const blobURL=async(file:CloudFile)=>{let url=urls.get(key(file));if(!url){const body=await read(file);url=URL.createObjectURL(new Blob([body as BlobPart],{type:file.mime}));urls.set(key(file),url)}return url};
      const options={
        read:async(file:CloudFile)=>new Blob([await read(file) as BlobPart],{type:file.mime}),
        url:async(file:CloudFile)=>{const entry=archive.find(file.ref.url,file.ref.ts);if(!entry)throw Error(`Missing original download: ${file.filename}`);return file.ref.member?.length||file.mime==='application/pdf'?blobURL(file):recordURL(archive,entry)},
        download:async(file:CloudFile)=>{const link=globalThis.document.createElement('a');link.href=await blobURL(file);link.download=file.filename.split('/').pop()!;link.click()},
        browseZip:async(file:CloudFile,doc:Document)=>{
          const zip=await openZipMembers(await read(file),context.signal);let files:CloudFile[];
          try{files=zip.members.map(member=>({path:'files/'+member.path,filename:member.path,format:member.path.split('.').pop()||'file',mime:member.mime,size:member.size,sha256:'',ref:{...file.ref,member:[...(file.ref.member||[]),member.path]}}))}finally{await zip.close()}
          const frame=doc.createElement('iframe');frame.title=file.filename;frame.srcdoc=template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replaceAll('{{ plugin_icon }}','📦');
          frame.onload=()=>{if(frame.contentDocument)cleanups.push(initializeCloudFiles(frame.contentDocument,{title:file.filename,files},options))};doc.getElementById('content')!.replaceChildren(frame);
        },
      };
      cleanups.push(initializeCloudFiles(document,data,options));
      return ()=>{cleanups.forEach(cleanup=>cleanup());urls.forEach(url=>URL.revokeObjectURL(url))};
    },
  }};
}
export function cloudCard(context:ViewContext,plugin:string,template:string){
  const data=cloudEvidence(context,plugin)||{title:'Saved files',files:[]};
  const document=new DOMParser().parseFromString(template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),'text/html');
  initializeCloudFilesCard(document,data);return '<!doctype html>'+document.documentElement.outerHTML;
}
