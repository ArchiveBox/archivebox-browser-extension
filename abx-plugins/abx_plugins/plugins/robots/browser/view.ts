import type {ViewContext,ViewResult} from '@/src/archive/views';
import fullTemplate from '@/vendor/archivebox/plugins/htmltotext/full.html?raw';
export default async function({archive,url}:ViewContext):Promise<ViewResult>{
  const entry=archive.find(new URL('/robots.txt',url).href),text=entry?await archive.text(entry):'';
  return {title:'Robots.txt',summary:'',sections:[],presentation:{type:'canonical',plugin:'robots',title:'Robots.txt',template:fullTemplate.replaceAll('HTML to Text','Robots.txt'),format:'text',filename:'robots.txt',data:text,initialize(document,data){
    const article=document.getElementById('article')!;article.style.cssText='max-width:none;font:14px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap';article.textContent=entry?data:'Robots.txt not archived';
  }}};
}
