/** Compiled source port of vendor/archivebox/plugins/liteparse/full.html.
 * Saved OCR results and original WACZ responses replace output-file reads. */
export function initializeLiteParse(document,sources,options){
  const raw=url=>String(url),urls=[],subscriptions=[],controllers=new Set();let disposed=false;
  let snapshotHost='';try{snapshotHost=new URL(options.url).hostname}catch{}
  const files=document.getElementById('files');files.href='#view=liteparse&files=1';files.addEventListener('click',event=>{event.preventDefault();options.openFiles()});
  const mainDownload=document.getElementById('download'),mainRaw=document.getElementById('raw');
  for(const link of [mainDownload,mainRaw])link.addEventListener('click',event=>{if(!link.href)event.preventDefault()});
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node};
  const basename=path=>path.split('/').pop();
  const isImage=name=>/\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(name);
  const gallery=document.getElementById('gallery'),search=document.getElementById('search'),count=document.getElementById('count'),empty=document.getElementById('empty');
  const entries=[];let selected='All';
  const chips=['All','Images','Documents'].map(group=>{const button=el('button',group);button.type='button';button.addEventListener('click',()=>{selected=group;filter()});document.getElementById('filters').append(button);return {group,button}});
  function filter(){
    const query=search.value.trim().toLowerCase();let visible=0;
    for(const entry of entries){entry.tile.hidden=entry.excluded||!(entry.search.toLowerCase().includes(query)&&(selected==='All'||entry.group===selected));if(!entry.tile.hidden)visible++;if(entry.tile.hidden)entry.controller?.abort();else if(entry.visible)load(entry)}
    for(const {group,button} of chips){button.setAttribute('aria-pressed',String(group===selected));button.textContent=group+' '+entries.filter(entry=>!entry.excluded&&(group==='All'||entry.group===group)&&entry.search.toLowerCase().includes(query)).length}
    count.textContent=visible+' / '+entries.filter(entry=>!entry.excluded).length;empty.hidden=visible>0;
  }
  const previews=new IntersectionObserver(items=>{for(const item of items){const entry=item.target.entry;entry.visible=item.isIntersecting;if(entry.visible&&!entry.tile.hidden)load(entry);else entry.controller?.abort()}},{rootMargin:'0px'});
  async function load(entry){
    if(!disposed&&entry.memberImage&&!entry.imageLoading){entry.imageLoading=true;void entry.document.source.original().then(({body,mime})=>{if(disposed)return;const url=URL.createObjectURL(new Blob([body],{type:mime}));urls.push(url);entry.memberImage.src=url;entry.memberLink.href=url;entry.originalLink.href=url;entry.originalLink.hidden=false}).catch(error=>{if(!disposed)entry.original.replaceChildren(el('span',String(error),'placeholder'))})}
    if(disposed||!entry.ready||entry.excluded||entry.result||entry.controller&&!entry.controller.signal.aborted)return;
    if(entry.pdfFrame&&!entry.pdfLoading){entry.pdfLoading=true;void options.originalPDF(entry.document.source).then(url=>{if(disposed){URL.revokeObjectURL(url);return}urls.push(url);entry.pdfFrame.src=url+'#toolbar=0&navpanes=0';entry.originalLink.href=url;entry.originalLink.hidden=false}).catch(error=>{if(!disposed)entry.original.append(el('span',String(error),'placeholder'))})}
    const controller=new AbortController();entry.controller=controller;controllers.add(controller);
    try{
      const result=await entry.document.source.load(controller.signal);if(disposed||controller.signal.aborted)return;entry.result=result;
      entry.preview.textContent=result.text.trim()?result.text:'No text detected.';
      for(const format of ['txt','json']){const text=format==='txt'?result.text:JSON.stringify(result,null,2),url=URL.createObjectURL(new Blob([text],{type:format==='txt'?'text/plain;charset=utf-8':'application/json;charset=utf-8'}));urls.push(url);entry.document.formats[format]=url;const link=entry.formatLinks[format];link.href=url;link.download=entry.document.name+'.'+format;link.removeAttribute('aria-disabled')}
      entry.download.href=entry.document.formats.txt;entry.download.removeAttribute('aria-disabled');
      if(entry===entries[0]){mainDownload.href=entry.document.formats.txt;mainDownload.download=entry.document.name+'.txt';mainRaw.href=entry.document.formats.txt;mainRaw.target='_blank'}
    }catch(error){if(!controller.signal.aborted&&!disposed)entry.preview.textContent=String(error)}finally{controllers.delete(controller);if(entry.controller===controller)entry.controller=undefined}
  }
  function showFilename(entry){
    const source=entry.source?.originalURL||'';
    entry.search=[entry.name,entry.document.name,source||''].join(' ');
    const filename=el(source?'button':'span',source?null:entry.name,source?'filename source-url':'filename');
    filename.title=source||entry.name;
    if(source){
      filename.type='button';filename.setAttribute('aria-label','Copy URL: '+source);
      let pathname=source,domain='';try{const original=new URL(source);if(original.hostname!==snapshotHost)domain=original.host;pathname=original.pathname}catch{}
      const split=pathname.lastIndexOf('/'),start=el('span',null,'url-start'),tail=pathname.slice(split+1);
      if(domain)start.append(el('span',domain,'url-domain'));
      start.append(document.createTextNode(pathname.slice(0,split+1)));filename.append(start,el('span',tail,'url-end'));
      filename.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(source);filename.title='Copied! '+source;filename.setAttribute('aria-label','Copied URL: '+source);setTimeout(()=>{filename.title=source;filename.setAttribute('aria-label','Copy URL: '+source)},1500)}catch{filename.title='Could not copy URL: '+source}});
    }
    entry.filename.replaceWith(filename);entry.filename=filename;
  }
  function showSource(entry,hint){
    const source=entry.document.source;entry.original.replaceChildren();entry.originalLink.hidden=true;
    entry.source=source;entry.name=hint||basename(entry.document.name);showFilename(entry);
    if(!source){entry.original.append(el('span','Original file unavailable','placeholder'));filter();return}
    entry.originalLink.hidden=Boolean(source.original);entry.originalLink.href=raw(source.url);entry.originalLink.title='Open original: '+source.name;
    const link=el('a');link.href=raw(source.url);link.setAttribute('aria-label',entry.originalLink.title);entry.original.append(link);
    if(isImage(source.name)||source.mime.startsWith('image/')){
      const img=el('img');img.alt=source.name;img.loading='lazy';img.decoding='async';
      img.addEventListener('load',()=>{entry.dimensions.textContent=img.naturalWidth+' × '+img.naturalHeight;entry.ready=true;entry.excluded=img.naturalWidth<source.minimumDimension&&img.naturalHeight<source.minimumDimension;filter()});
      img.addEventListener('error',()=>{link.replaceChildren(el('span','Image preview unavailable — open original','placeholder'))});
      if(source.original){entry.memberImage=img;entry.memberLink=link;link.removeAttribute('href')}else img.src=raw(source.url);link.append(img);
    }else if(/\.pdf$/i.test(source.name)||source.mime==='application/pdf'){
      const frame=el('iframe');frame.title='Original PDF: '+source.name;frame.loading='lazy';entry.pdfFrame=frame;entry.original.replaceChildren(frame);
    }else{const placeholder=el('span',null,'placeholder');placeholder.append(el('span',/\.pdf$/i.test(source.name)?'📕':'📄','file-icon'),el('span','Open original document'));link.append(placeholder)}
    filter();
  }
  // Match the responses gallery: type, original bytes descending, then path.
  const sourceRank=file=>{
    const mime=file.mime.toLowerCase().split(';')[0],ext=file.path.split('.').pop().toLowerCase();
    if(mime.startsWith('video/'))return 0;
    if(mime.startsWith('audio/'))return 1;
    if(mime==='application/pdf'||mime==='application/epub+zip'||/officedocument|opendocument|msword|ms-excel|ms-powerpoint/.test(mime)||['pdf','epub','doc','docx','ppt','pptx','xls','xlsx','odt','ods','odp','rtf','md','markdown'].includes(ext)||['text/markdown','text/x-markdown'].includes(mime))return 2;
    if(mime.startsWith('image/')||isImage(file.path))return 3;
    if(mime==='text/html'||mime==='application/xhtml+xml'||['html','htm'].includes(ext))return 4;
    if(mime.startsWith('font/')||/font|woff/.test(mime)||['woff','woff2','ttf','otf','eot','ttc'].includes(ext))return 6;
    if((mime.startsWith('application/')&&!/json|xml|javascript|ecmascript|sql|yaml|toml|graphql/.test(mime))||/zip|compressed|archive|wasm|executable/.test(mime))return 5;
    return 7;
  };
  const ordered=sources.map(source=>{const native={...source,path:source.source.member?.at(-1)||new URL(source.entry.url).pathname,originalURL:source.entry.url,url:options.resourceURL(source.entry)};return{source:native,document:{name:source.name,source:native,formats:{}}}}).sort((a,b)=>sourceRank(a.source)-sourceRank(b.source)||(Number(b.source.size)||0)-(Number(a.source.size)||0)||a.source.path.localeCompare(b.source.path));
  for(const {document} of ordered){
    const tile=el('figure',null,'tile'),comparison=el('div',null,'comparison');
    const left=el('div',null,'pane'),right=el('div',null,'pane'),original=el('div',null,'original'),preview=el('pre','Loading parsed text…','text-preview');
    preview.tabIndex=0;preview.setAttribute('aria-label','Parsed text: '+basename(document.name));
    left.append(el('span','Original','pane-label'),original);right.append(el('span','Parsed text','pane-label'),preview);comparison.append(left,right);
    const caption=el('figcaption'),filename=el('span',basename(document.name),'filename'),meta=el('span',null,'source'),dimensions=el('span','','dimensions'),actions=el('span',null,'file-actions');
    const formatLinks={};for(const format of ['txt','json']){const link=el('a',format.toUpperCase());link.title='Open '+format.toUpperCase();link.setAttribute('aria-disabled','true');link.addEventListener('click',event=>{if(!link.href)event.preventDefault()});formatLinks[format]=link;actions.append(link)}
    const originalLink=el('a','Original');originalLink.hidden=true;actions.prepend(originalLink);
    const download=el('a','⤓');download.download=basename(document.name)+'.txt';download.setAttribute('aria-disabled','true');download.addEventListener('click',event=>{if(!download.href)event.preventDefault()});download.setAttribute('aria-label','Download parsed text: '+basename(document.name));download.title='Download parsed text';actions.append(download);
    meta.append(dimensions,actions);caption.append(filename,meta);tile.append(comparison,caption);gallery.append(tile);
    const entry={document,tile,original,originalLink,preview,filename,dimensions,name:basename(document.name),search:document.name,group:document.source.mime.startsWith('image/')?'Images':'Documents',ready:!document.source.mime.startsWith('image/'),formatLinks,download};
    const update=()=>{const partial=document.source.peek();if(partial?.text.trim())preview.textContent=partial.text};
    subscriptions.push(document.source.subscribe(update));update();
    entries.push(entry);showSource(entry);preview.entry=entry;previews.observe(preview);
  }
  search.addEventListener('input',filter);filter();
  return()=>{disposed=true;previews.disconnect();subscriptions.forEach(unsubscribe=>unsubscribe());controllers.forEach(controller=>controller.abort());urls.forEach(url=>URL.revokeObjectURL(url))};
}
