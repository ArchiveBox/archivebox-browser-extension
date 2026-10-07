import type {ArchiveEntry,ArchiveReader} from '../archive/reader';
import type {Capture} from '../capture/types';
import type {DocumentSource} from '../../abx-plugins/abx_plugins/plugins/liteparse/browser/view';
import {mountReplay,recordURL} from '../archive/replay';
import responsesTemplate from '../../vendor/archivebox/plugins/responses/card.html?raw';
import liteparseTemplate from '../../vendor/archivebox/plugins/liteparse/card.html?raw';

export type ResourceCardPreviewOptions={archive:ArchiveReader;capture:Capture;plugin:'responses'|'liteparse';signal?:AbortSignal;onUpdate?:(content:HTMLElement)=>void};
type Original={entry:ArchiveEntry;name:string;extension:string;size:number;mime:string;digest?:string;original?:DocumentSource['original']};
type Parsed={original:Original;source:DocumentSource};
const originalsCache=new WeakMap<ArchiveReader,Promise<Original[]>>();
const parsedCache=new WeakMap<ArchiveReader,Promise<Parsed[]>>();
const documentExtensions=new Set(['pdf','epub','doc','docx','ppt','pptx','xls','xlsx','odt','ods','odp','rtf','md','markdown']);
const documentMimes=new Set(['application/pdf','application/epub+zip','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint','text/markdown','text/x-markdown']);
function isDocument(mime:string,extension:string){return documentMimes.has(mime)||mime.includes('officedocument')||mime.includes('opendocument')||documentExtensions.has(extension);}
function basename(url:string){return new URL(url).pathname.split('/').pop()||'';}
function sanitized(name:string){return name.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,96)||'source';}
function originals(archive:ArchiveReader) {
  let promise=originalsCache.get(archive);
  if(!promise){promise=(async()=>{
    const result:Original[]=[];
    // WACZ replaces responses/all timestamped paths; only original HTTP bodies
    // are eligible, never screenshot/printed-PDF evidence URNs.
    for(const entry of archive.entries){
      if(entry.method==='HEAD'||!/^https?:/i.test(entry.url)||entry.status<200||entry.status>=300)continue;
      const name=basename(entry.url),mime=entry.mime.split(';')[0]!.trim();
      const extension=name.includes('.')?name.split('.').pop()!.toLowerCase():'';
      if(!mime.startsWith('image/')&&!isDocument(mime,extension))continue;
      const {headers,image}=await archive.headers(entry);
      // One-pixel spacers/tracking pixels remain in Responses, but cannot
      // provide a visible preview of the captured page's resources.
      if(image&&(image.width<=1||image.height<=1))continue;
      const length=headers['content-length'];
      // Index entry.length is compressed WARC record length, not file size.
      const size=length!==undefined&&/^\d+$/.test(length)&&!headers['content-encoding']?Number(length):0;
      result.push({entry,name,extension:mime==='application/pdf'?'pdf':extension,size,mime});
    }
    return result;
  })();originalsCache.set(archive,promise);}
  return promise;
}
function parsed(archive:ArchiveReader,capture:Capture) {
  let promise=parsedCache.get(archive);
  if(!promise){promise=(async()=>{
    // The canonical card reads the same saved results as the full view.
    const {default:view}=await import('../../abx-plugins/abx_plugins/plugins/liteparse/browser/view');
    const result=await view({archive,capture,url:capture.finalUrl||capture.url});
    const documents:Parsed[]=[];
    for(const source of result.presentation?.type==='documents'?result.presentation.documents.slice(0,9):[]){
      const {entry,name,mime,size,digest,original}=source;
      documents.push({original:{entry,name,mime,size,digest,original,extension:mime==='application/pdf'?'pdf':name.split('.').pop()||''},source});
    }
    // Canonical card order: original file size descending, then sanitized name.
    return documents.sort((a,b)=>b.original.size-a.original.size||sanitized(a.original.name).localeCompare(sanitized(b.original.name)));
  })();parsedCache.set(archive,promise);}
  return promise;
}
function opening(template:string,className:string) {
  const markup=template.match(new RegExp(`<div class="${className}"[^>]*>`))?.[0];
  if(!markup)throw Error(`Canonical ${className} markup missing`);
  const shell=document.createElement('template');shell.innerHTML=markup+'</div>';
  return shell.content.firstElementChild as HTMLDivElement;
}
function scriptStyle(template:string,variable:string,index=0) {
  const matches=[...template.matchAll(new RegExp(`${variable}\\.style\\.cssText = '([^']+)'`,'g'))];
  if(!matches[index])throw Error(`Canonical ${variable} style missing`);
  return matches[index]![1]!;
}
async function imageSource(image:HTMLImageElement,archive:ArchiveReader,source:Original,signal?:AbortSignal){
  if(!source.original){image.src=recordURL(archive,source.entry);return}
  const {body,mime}=await source.original(signal);signal?.throwIfAborted();
  const url=URL.createObjectURL(new Blob([body as BlobPart],{type:mime})),release=()=>URL.revokeObjectURL(url);
  // Snapshot cards are cloned into stack covers; keep their shared URL valid
  // until the enclosing snapshot releases every clone.
  signal?.addEventListener('abort',release,{once:true});image.src=url;
}
async function responseTile(archive:ArchiveReader,source:Original,signal?:AbortSignal) {
  const {name,mime,extension}=source;
  let item:HTMLElement;
  if(mime.startsWith('image/')||/\.(png|jpe?g|gif|bmp|tiff?|webp|svg)$/i.test(name)){
    const image=document.createElement('img');image.alt=name;image.loading='lazy';image.decoding='async';image.fetchPriority='low';await imageSource(image,archive,source,signal);
    image.style.cssText=scriptStyle(responsesTemplate,'item',0);item=image;
  }else{
    item=document.createElement('span');item.title=name;item.setAttribute('aria-label',`Document: ${name}`);item.style.cssText=scriptStyle(responsesTemplate,'item',1);
    const icon=document.createElement('span');icon.style.fontSize='24px';icon.textContent='📄';item.append(icon,document.createTextNode(extension.toUpperCase()));
  }
  item.dataset.name=name;item.dataset.size=String(source.size);return item;
}

/** Direct DOM card preview. Caller retains its current preview while awaiting
 * this promise, then replaces that child (preserving the card click overlay).
 * Grid/tile markup and CSS are taken from the vendored canonical card templates.
 * See ResourceCardPreview.provenance.md for the WACZ resolution adaptation. */
export async function createResourceCardPreview({archive,capture,plugin,signal,onUpdate}:ResourceCardPreviewOptions):Promise<HTMLElement> {
  signal?.throwIfAborted();await mountReplay(archive);signal?.throwIfAborted();
  const container=document.createElement('div');container.style.cssText='width:100%;height:100%;overflow:hidden;';
  if(plugin==='liteparse'){
    const grid=opening(liteparseTemplate,'liteparse-thumbnail');container.append(grid);
    const documents=await parsed(archive,capture);signal?.throwIfAborted();
    for(const document of documents.slice(0,9)){
      const tile=window.document.createElement('div');tile.className='liteparse-thumbnail-tile';tile.title=sanitized(document.original.name);tile.style.cssText=scriptStyle(liteparseTemplate,'tile');
      const original=window.document.createElement('div'),text=window.document.createElement('pre');original.style.cssText=scriptStyle(liteparseTemplate,'original');text.style.cssText=scriptStyle(liteparseTemplate,'text');
      const source=document.original;
      if(source.mime.startsWith('image/')||/\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(source.name)){
        const image=window.document.createElement('img');image.alt=source.name;image.loading='lazy';image.decoding='async';image.style.cssText=scriptStyle(liteparseTemplate,'image');await imageSource(image,archive,source,signal);original.append(image);
      }else{original.textContent='📄';original.title=source.name;}
      const update=()=>{const result=document.source.peek();text.textContent=result?(result.text.trim()?result.text.slice(0,2000):'No text detected'):''};update();
      const unsubscribe=document.source.subscribe(()=>{update();onUpdate?.(container)});
      signal?.addEventListener('abort',unsubscribe,{once:true});
      tile.append(original,text);grid.append(tile);
    }
    if(!documents.length)grid.textContent='No parsed files';
    return container;
  }
  const grid=opening(responsesTemplate,'responses-thumbnail'),summary=opening(responsesTemplate,'responses-summary');
  const strong=document.createElement('strong');strong.textContent='Captured responses';const empty=document.createElement('div');empty.textContent='No document or image thumbnails';summary.append(strong,empty);container.append(grid,summary);
  const files=await originals(archive);signal?.throwIfAborted();
  // The response card displays originals and never starts text extraction.
  const documents=capture.plugins.includes('liteparse')?await parsed(archive,capture):[];signal?.throwIfAborted();
  const seen=new Set<string>(),selected:Original[]=[];
  if(documents.length){
    // Canonical LiteParse-aligned branch slices before de-duplicating.
    for(const {original:source} of documents.slice(0,9)){
      const identity=source.digest||source.entry.digest||source.entry.url;if(seen.has(identity))continue;seen.add(identity);selected.push(source);
    }
  }else{
    files.sort((a,b)=>b.size-a.size||a.name.localeCompare(b.name)||a.entry.url.localeCompare(b.entry.url));
    for(const source of files){
      if(selected.length>=9)break;
      const keys=[source.entry.digest,source.entry.url].filter(Boolean);if(keys.some(key=>seen.has(key)))continue;keys.forEach(key=>seen.add(key));selected.push(source);
    }
  }
  grid.append(...await Promise.all(selected.map(source=>responseTile(archive,source,signal))));grid.style.display=selected.length?'grid':'none';summary.hidden=selected.length>0;
  return container;
}
