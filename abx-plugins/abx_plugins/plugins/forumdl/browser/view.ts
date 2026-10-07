import type {ViewContext,ViewResult} from '@/src/archive/views';
import {extractArchivedForum} from '@/vendor/forum-dl/offline';
export type ForumRecord={type:'board'|'thread'|'post'|'file';extractor:string;item:Record<string,any>};
export type ForumPresentation={type:'forum';records:ForumRecord[]};
export default function(context:ViewContext):Promise<ViewResult>{context.signal?.throwIfAborted();return derive(context);}
async function derive({archive,url,signal}:ViewContext):Promise<ViewResult>{
  const plugin=archive.metadata?.plugins?.find((item:any)=>item.id==='forumdl');
  const refs=plugin?.hooks?.flatMap((hook:any)=>hook.records||[])||[];
  const records:ForumRecord[]=[];
  if(plugin&&refs.length&&!plugin.hooks.every((hook:any)=>hook.status==='noresults')){
    const result=await extractArchivedForum(archive,url,refs,plugin.config?.FORUMDL_FILES!==false,signal);
    for(const [type,items]of [['board',result.boards],['thread',result.threads],['post',result.posts],['file',result.files]] as const)
      for(const item of items)records.push({type,extractor:result.family,item});
  }
  return {title:'Forum thread',summary:'',sections:[],presentation:{type:'forum',records}};
}
