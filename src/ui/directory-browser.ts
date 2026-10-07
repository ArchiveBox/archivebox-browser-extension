import template from '../../vendor/archivebox/directory_index.html?raw';
import {downloadZip} from 'client-zip';

export type DirectoryFile = {
  path:string; mime:string; size?:number; title?:string; href?:string;
  url?:string|(()=>Promise<string>); read:()=>Promise<Blob>;
  open?:()=>void|Promise<void>;
};
export type DirectoryOptions = {title:string; files:DirectoryFile[]; snapshot?:()=>void; output?:()=>void};

// ArchiveBox static/directory_index.html, with only the filesystem adapter replaced.
// A shadow root keeps the original styles out of the surrounding plugin document.
const css=template.match(/<style>([\s\S]*?)<\/style>/)![1]!
  .replace(':root',':host').replace('html, body',':host').replace('@media (max-width: 640px)','@container (max-width: 640px)').replace('.size-column { width: 65px; }','.size-column { width: 80px; }');
const markup=template.match(/<main>[\s\S]*?<\/main>/)![0];
const bytes=(size?:number)=>size===undefined?'—':size<1024?`${size} B`:size<1048576?`${(size/1024).toFixed(1)} KB`:size<1073741824?`${(size/1048576).toFixed(1)} MB`:`${(size/1073741824).toFixed(2)} GB`;
const valid=(path:string)=>path&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(part=>!part||part==='.'||part==='..');

export function mountDirectoryBrowser(host:HTMLElement,options:DirectoryOptions):()=>void {
  const document=host.ownerDocument,root=host.shadowRoot||host.attachShadow({mode:'open'});
  root.innerHTML=`<style>${css}\n:host{display:block;container-type:inline-size;min-width:0} [hidden]{display:none!important} button{font:inherit} .directory-toolbar button{cursor:pointer;color:inherit} .directory-error{color:#b42318;padding:8px 12px} .directory-title{min-width:0} </style>${markup}`;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node};
  const get=<T extends Element=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
  const tbody=get<HTMLTableSectionElement>('tbody'),filter=get<HTMLInputElement>('#filter-files'),toolbar=get('.directory-toolbar');
  let prefix='',sortKey='name',direction=1,disposed=false,generation=0;
  const urls=new Set<string>(),files=options.files.filter(file=>valid(file.path));
  const report=(reason:unknown)=>{if(disposed)return;const error=get('.directory-error');error.textContent=String(reason);error.removeAttribute('hidden')};
  const objectURL=(blob:Blob)=>{if(disposed)throw new DOMException('Directory closed','AbortError');const url=URL.createObjectURL(blob);urls.add(url);return url};
  const save=(blob:Blob,name:string)=>{if(disposed)return;const url=objectURL(blob),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url)},60000)};
  const busy=async(link:HTMLElement,run:()=>Promise<void>)=>{if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');link.classList.add('is-loading');try{await run()}catch(error){report(error)}finally{link.removeAttribute('aria-busy');link.classList.remove('is-loading')}};
  const zip=async(path:string)=>{
    async function* entries(){for(const file of files.filter(file=>file.path.startsWith(path))){if(disposed)return;yield {name:file.path.slice(path.length),input:await file.read()}}}
    save(await downloadZip(entries()).blob(),(path.split('/').filter(Boolean).at(-1)||options.title)+'.zip');
  };
  const action=(label:string,callback:()=>void,cls='toolbar-link')=>{const button=el('button',label,cls);button.type='button';button.onclick=callback;toolbar.append(button);return button};
  const up=action('↩ Up One Level',()=>browse(parent()));
  if(options.snapshot)action('⌂ Snapshot Page',options.snapshot);
  if(options.output)action('Open output',options.output);
  const download=action('⬇ Download Zip',()=>{void busy(download,()=>zip(prefix))},'toolbar-link archivebox-zip-button');
  download.prepend(el('span',undefined,'archivebox-zip-spinner'));
  const parent=()=>prefix.split('/').slice(0,-2).join('/')+(prefix.split('/').length>2?'/':'');
  const previewFiles=new WeakMap<Element,DirectoryFile>();
  const previews=new IntersectionObserver(items=>{for(const item of items){if(!item.isIntersecting)continue;previews.unobserve(item.target);const file=previewFiles.get(item.target)!;const token=generation;
    void(async()=>{if(item.target.tagName==='IMG'){const url=typeof file.url==='function'?await file.url():file.url||objectURL(await file.read());if(!disposed&&token===generation)(item.target as HTMLImageElement).src=url}
      else {const text=await(await file.read()).text();if(!disposed&&token===generation)item.target.textContent=text.slice(0,12000)}})().catch(()=>{if(!disposed&&token===generation)item.target.replaceWith(el('span','📄','entry-icon'))});
  }},{rootMargin:'100px'});
  function applyFilter(){let count=0;for(const row of tbody.querySelectorAll<HTMLTableRowElement>('.directory-entry:not(.parent)')){row.hidden=!row.dataset.name!.toLowerCase().includes(filter.value.toLowerCase());if(!row.hidden)count++}get('#visible-file-count').textContent=String(count);const empty=get('.empty-state');empty.toggleAttribute('hidden',count>0);empty.textContent=filter.value?'No matching files.':'This directory is empty.'}
  function sort(){const rows=[...tbody.querySelectorAll<HTMLTableRowElement>('.directory-entry:not(.parent)')];rows.sort((a,b)=>{const folders=Number(b.classList.contains('folder'))-Number(a.classList.contains('folder'));if(folders)return folders;const comparison=sortKey==='size'?Number(a.dataset.size)-Number(b.dataset.size):a.dataset[sortKey]!.localeCompare(b.dataset[sortKey]!,undefined,{numeric:true,sensitivity:'base'});return direction*comparison||a.dataset.name!.localeCompare(b.dataset.name!,undefined,{numeric:true})});rows.forEach(row=>tbody.append(row));root.querySelectorAll('th[aria-sort]').forEach(header=>header.setAttribute('aria-sort','none'));get(`[data-sort="${sortKey}"]`).parentElement!.setAttribute('aria-sort',direction===1?'ascending':'descending')}
  function browse(path:string){prefix=path;generation++;previews.disconnect();tbody.replaceChildren();filter.value='';up.hidden=!prefix;get('.directory-title').textContent=prefix?`${options.title} / ${prefix}`:options.title;
    const items=new Map<string,{path:string;name:string;directory:boolean;file?:DirectoryFile}>();
    for(const file of files){if(!file.path.startsWith(prefix))continue;const tail=file.path.slice(prefix.length),name=tail.split('/')[0]!;const directory=tail.includes('/');items.set(name,{name,path:prefix+name+(directory?'/':''),directory,file:directory?undefined:file})}
    function row(item:{name:string;path:string;directory:boolean;file?:DirectoryFile},isParent=false){const {file,directory}=item,tr=el('tr',undefined,'directory-entry'+(isParent?' parent':directory?' folder':''));tr.dataset.name=item.name;tr.dataset.size=String(file?.size??-1);tr.dataset.type=directory?'Directory':file!.mime;
      const name=el('td'),link=el('a',undefined,'directory-link');link.href=file?.href|| (typeof file?.url==='string'?file.url:'#');link.title=file?.title||item.path;
      if(directory||file?.open||!file?.href){link.onclick=event=>{event.preventDefault();if(directory)browse(item.path);else void Promise.resolve(file!.open?file!.open():open(file!)).catch(report)}}
      let icon:HTMLElement=el('span',isParent?'↩':directory?'📁':'📄','entry-icon');
      if(file&&file.size!==undefined&&file.size<100*1024){if(file.mime.startsWith('image/')){const img=el('img',undefined,'entry-preview');img.alt='';img.loading='lazy';img.decoding='async';icon=img}
        else if(file.mime.startsWith('text/')||/(?:^|[.+/-])(?:json|xml|javascript|ecmascript|yaml|toml|graphql|sql)(?:[.+/-]|$)/.test(file.mime)||/\.(log|jsonl|toml)$/.test(file.path))icon=el('pre','…','entry-preview');
        if(icon.className==='entry-preview'){previewFiles.set(icon,file);previews.observe(icon)}}
      icon.setAttribute('aria-hidden','true');const label=el('span',undefined,'entry-label'),filename=el('span',item.name+(directory&&!isParent?'/':''),'entry-name');filename.title=item.name;label.append(filename);link.append(icon,label);name.append(link);
      const type=el('td',directory?'Directory':file!.mime,'entry-type');type.title=type.textContent!;const last=el('td');
      if(!isParent){const button=el('a','⬇','entry-download');button.href=typeof file?.url==='string'?file.url:'#';button.download=item.name+(directory?'.zip':'');button.title=`Download ${item.name}`;button.setAttribute('aria-label',button.title);button.onclick=event=>{event.preventDefault();void busy(button,async()=>{if(directory)await zip(item.path);else save(await file!.read(),item.name)})};last.append(button)}
      tr.append(name,el('td',directory?'—':bytes(file!.size),'entry-size'),type,last);tbody.append(tr);
    }
    if(prefix)row({name:'../',path:parent(),directory:true},true);items.forEach(item=>row(item));sort();applyFilter();
  }
  async function open(file:DirectoryFile){const url=typeof file.url==='function'?await file.url():file.url||objectURL(await file.read());if(disposed)return;const link=el('a');link.href=url;link.target='_blank';link.rel='noopener';document.body.append(link);link.click();link.remove()}
  filter.oninput=applyFilter;
  root.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(button=>{button.onclick=()=>{direction=sortKey===button.dataset.sort?-direction:1;sortKey=button.dataset.sort!;sort()}});
  browse('');
  return()=>{disposed=true;generation++;previews.disconnect();urls.forEach(url=>URL.revokeObjectURL(url));root.replaceChildren()};
}
