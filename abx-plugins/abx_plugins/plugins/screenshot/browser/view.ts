import type {ViewContext,ViewResult} from '@/src/archive/views';
import {recordURL} from '@/src/archive/replay';
import template from '../../../../../vendor/archivebox/plugins/screenshot/full.html?raw';

export default async function({archive}:ViewContext):Promise<ViewResult>{
 const entries=archive.entries.filter(entry=>/^urn:(screenshot|fullPage):/.test(entry.url));
 const full=entries.filter(entry=>entry.url.startsWith('urn:fullPage:'));
 const images=await Promise.all((full.length?full:entries).map(async entry=>{
  const {warcHeaders}=await archive.headers(entry),metadata=JSON.parse(warcHeaders['WARC-JSON-Metadata']||'{}');
  return {url:recordURL(archive,entry),screenshot:metadata.screenshot};
 }));
 images.sort((a,b)=>(a.screenshot?.tile?.index||0)-(b.screenshot?.tile?.index||0));
 return {title:'Screenshot',summary:'',sections:[],presentation:{type:'canonical',plugin:'screenshot',title:'Screenshot',template:template.replace('src="{{ output_path }}"',''),data:images,initialize(document){
  const original=document.querySelector('img')!;
  if(!images.length){original.remove();return}
  const parent=original.parentElement!;
  if(images.length===1){original.src=images[0]!.url;return}
  // Position the original PNG tiles; no stitched image or second pixel copy.
  const full=images[0]!.screenshot?.capturedArea;
  if(full&&images.every(image=>image.screenshot?.version===1)){
   parent.style.position='relative';parent.style.width=full.width+'px';parent.style.minWidth='0';parent.style.maxWidth='100%';parent.style.aspectRatio=full.width+' / '+full.height;
   for(const image of images){const tile=image.screenshot.tile,img=original.cloneNode(true) as HTMLImageElement;img.src=image.url;img.style.position='absolute';img.style.left=100*(tile.x-full.x)/full.width+'%';img.style.top=100*(tile.y-full.y)/full.height+'%';img.style.width=100*tile.width/full.width+'%';img.style.height=100*tile.height/full.height+'%';parent.append(img)}
  }else for(const image of images){const img=original.cloneNode(true) as HTMLImageElement;img.src=image.url;parent.append(img)}
  original.remove();
 }}};
}
