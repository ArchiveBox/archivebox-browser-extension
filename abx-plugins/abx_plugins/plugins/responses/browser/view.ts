import type {ViewContext,ViewResult} from '@/src/archive/views';
export default async function({archive}:ViewContext):Promise<ViewResult>{
 return {title:'Responses',summary:`${archive.entries.filter(entry=>/^https?:/.test(entry.url)).length} requests`,sections:[],presentation:{type:'responses'}};
}
