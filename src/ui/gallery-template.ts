/** Script port of vendor/archivebox/plugins/gallerydl/full.html. The canonical
 * DOM, tiles, dialog and actions are retained. WACZ supplies resolved original
 * URLs in place of Django output_files and filesystem-relative paths. */
export function initializeGallery(document:Document,files:{url:string;name:string;size:number}[],openFiles:()=>void,downloadOriginal:(url:string)=>void){
 const output=files[0]?.url;
 const raw=(url:string)=>url;
 const filesLink=document.getElementById('files') as HTMLAnchorElement;filesLink.href='#view=responses';filesLink.addEventListener('click',event=>{event.preventDefault();openFiles()});
 if(output){(document.getElementById('download') as HTMLAnchorElement).href=raw(output);(document.getElementById('raw') as HTMLAnchorElement).href=output;}
 for(const id of ['download','viewer-download']){const link=document.getElementById(id) as HTMLAnchorElement;link.addEventListener('click',event=>{event.preventDefault();if(link.hasAttribute('href'))downloadOriginal(link.href)})}
 const el=<T extends keyof HTMLElementTagNameMap>(tag:T,text?:string|null,cls?:string)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n};
 const gallery=document.getElementById('gallery')!,viewer=document.getElementById('viewer') as HTMLDialogElement,seen=new Set<string>();
 const add=(url:string,name:string,source:string,size:number)=>{if(seen.has(url))return;seen.add(url);const tile=el('figure',null,'tile'),link=el('a'),img=el('img');link.href=url;link.title=name;img.src=raw(url);img.alt=name;img.loading='lazy';img.decoding='async';link.append(img);const caption=el('figcaption'),filename=el('span',name,'filename'),meta=el('span',null,'source');filename.title=name;meta.append(el('span',source));const bytes=Number(size);if(bytes>0)meta.append(el('span',bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.ceil(bytes/1024)+' KB'));caption.append(filename,meta);tile.append(link,caption);gallery.append(tile);link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();const image=document.getElementById('viewer-image') as HTMLImageElement;image.src=raw(url);image.alt=name;document.getElementById('viewer-name')!.textContent=name;(document.getElementById('viewer-download') as HTMLAnchorElement).href=raw(url);viewer.showModal()})};
 for(const file of files)add(file.url,file.name,'GalleryDL',file.size);
 document.getElementById('count')!.textContent=seen.size+' images';if(!seen.size)gallery.replaceWith(el('p','No captured images','empty'));
 document.getElementById('close')!.addEventListener('click',()=>viewer.close());viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close()});
}
