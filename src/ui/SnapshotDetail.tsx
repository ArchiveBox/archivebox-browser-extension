import React from 'react';
import type { ArchiveReader } from '../archive/reader';
import type { Capture } from '../capture/types';
import {plugins} from '../capture/registry';
import { views, deriveView, type ViewResult } from '../archive/views';
import {hasOutput} from '../archive/availability';
import { Viewer, HTMLPreview } from './Viewer';
import { ReplayWebPage } from './ReplayWebPage';
import { SnapshotHeader, type SnapshotHeaderProps } from './SnapshotHeader';
export { formatSize } from './SnapshotHeader';
import { recordURL } from '../archive/replay';
import { outputGroups, orderedPlugins, presentation, pluginName, pluginIcon, cardTemplate } from './presentation';
import {createGalleryCardPreview} from './GalleryPreview';
import {createResourceCardPreview} from './ResourceCardPreview';
import {PluginFiles} from './PluginFiles';
import {createYtdlpCardPreview} from './YtdlpPreview';
import {mountCardPreviews} from './CardPreview';
// This controller is the vendored ArchiveBox snapshot stack implementation.
import { initializeOutputStacks } from '../../vendor/archivebox/stacks.js';
import '../../vendor/archivebox/snapshot.css';
import './snapshot.css';

export function CaptureActivity({capture}:{capture:Capture}) {
  return <section className="view-section"><h2>Archive results</h2><div className="timeline">{capture.hooks.filter(hook=>plugins[hook.plugin]).map(hook=><div className="hook-row" key={hook.hook}>
    <span className={`status-dot ${hook.status}`}/><div><strong>{pluginName(hook.plugin)}</strong><code>{hook.hook}</code>
    <p>{hook.summary || hook.logs.at(-1) || 'Running…'}</p>{hook.logs.length>0&&<details><summary>Logs</summary><pre>{hook.logs.join('\n')}</pre></details>}</div>
    <span className={`hook-status ${hook.status}`}>{hook.status}</span><time>{((hook.ended || Date.now()) - hook.started)/1000}s</time></div>)}</div></section>;
}

export function PluginOutput({archive,capture,name,active=true}:{archive:ArchiveReader;capture:Capture;name:string;active?:boolean}) {
  const [view,setView]=React.useState<ViewResult>();
  const [error,setError]=React.useState('');
  const folder=()=>new URLSearchParams(location.hash.slice(1)).get('view')===name&&new URLSearchParams(location.hash.slice(1)).get('files')==='1';
  const [folderOpen,setFiles]=React.useState(folder);
  const files=folderOpen||(!views[name]&&name!=='archivewebpage');
  React.useEffect(()=>{if(!active)return;const changed=()=>setFiles(folder());changed();addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed)},[active,name]);
  const output=React.useRef<HTMLDivElement>(null);
  React.useEffect(()=>{if(active)return;const pause=(root:Document|Element)=>{root.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media=>media.pause());root.querySelectorAll('iframe').forEach(frame=>{try{if(frame.contentDocument)pause(frame.contentDocument)}catch{/* Cross-origin replay cannot expose media controls. */}})};if(output.current)pause(output.current)},[active]);
  const url=capture.finalUrl||capture.url;
  React.useEffect(()=>{const controller=new AbortController();setView(undefined);setError('');
    if(!files&&name!=='archivewebpage')void deriveView(name,{archive,url,capture,signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setView(result)}).catch(reason=>{if(!controller.signal.aborted)setError(String(reason))});
    return()=>controller.abort();
  },[archive,capture,name,url,files]);
  const document=(name==='dom'||name==='singlefile')?view?.sections.find(section=>section.type==='html'):undefined;
  const pageEntry=archive.documentEntry();
  return <div ref={output} className="plugin-view" data-plugin={name} hidden={!active}>
    {files?<PluginFiles archive={archive} capture={capture} name={name}/>:error?<p role="alert" className="error">{error}</p>:name==='archivewebpage'?<ReplayWebPage archive={archive} url={pageEntry?.url||url} ts={pageEntry?.timestamp}/>:document?.type==='html'?<HTMLPreview archive={archive} html={document.html} url={url} standalone={name==='singlefile'}/>:view?<Viewer view={view} archive={archive} url={url}/>:<p className="loading">Loading {pluginName(name)}…</p>}
  </div>;
}

/** Markup, presentation metadata and stack controller come from ArchiveBox's snapshot templates. */
export function SnapshotDetail({archive,capture,...headerProps}:Omit<SnapshotHeaderProps,'expanded'|'onToggleOutputs'>) {
  const [expanded,setExpanded]=React.useState(true);
  const candidates=React.useMemo(()=>[...new Set([...Object.keys(views),...capture.hooks.filter(hook=>plugins[hook.plugin]&&hook.records?.length).map(hook=>hook.plugin)])].filter(name=>(!capture.plugins.length||capture.plugins.includes(name))&&(!['dom','singlefile'].includes(name)||Boolean(archive.documentEntry()))),[archive,capture]);
  const checks=React.useMemo(()=>new Map(candidates.map(name=>[name,hasOutput(name,{archive,capture,url:capture.finalUrl||capture.url})])),[candidates,archive,capture]);
  const [resolved,setResolved]=React.useState<{checks:typeof checks;values:Map<string,boolean>}>();
  React.useEffect(()=>{let active=true;const pending=[...checks].filter(([,value])=>typeof value!=='boolean');
    if(pending.length)void Promise.all(pending.map(async([name,value])=>[name,await Promise.resolve(value).catch(()=>true)] as const)).then(values=>{if(active)setResolved({checks,values:new Map(values)})});
    return()=>{active=false};
  },[checks]);
  const availability=React.useMemo(()=>new Map([...checks].map(([name,value])=>[name,typeof value==='boolean'?value:resolved?.checks===checks?resolved.values.get(name):undefined])),[checks,resolved]);
  const available=React.useMemo(()=>candidates.filter(name=>availability.get(name)===true),[candidates,availability]);
  const names=React.useMemo(()=>orderedPlugins(available.filter(name=>Boolean(views[name]))),[available]);
  const defaultView=names.find(name=>presentation(name).snapshot_primary_preview&&(name==='screenshot'?archive.artifact('screenshot')||archive.artifact('fullPage'):archive.artifact(name))) || names[0] || 'responses';
  const initial=()=>{const requested=new URLSearchParams(location.hash.slice(1)).get('view');return requested&&candidates.includes(requested)&&availability.get(requested)!==false?requested:defaultView};
  const [panel,setPanel]=React.useState(initial);
  // Keep recent documents mounted, in stable DOM order. Reordering iframe
  // nodes reloads them. Bound the cache so large reports cannot accumulate.
  const [opened,setOpened]=React.useState([panel]);
  const recent=React.useRef([panel]);
  const select=React.useCallback((name:string)=>{
    recent.current=[...recent.current.filter(item=>item!==name),name].slice(-8);
    setOpened(old=>[...old.filter(item=>recent.current.includes(item)),...(old.includes(name)?[]:[name])]);
    setPanel(name);
  },[]);
  const root=React.useRef<HTMLDivElement>(null);
  const cardsHost=React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(()=>{const header=root.current!.querySelector('header')!;const resize=()=>root.current?.style.setProperty('--snapshot-navbar-height',`${header.getBoundingClientRect().height}px`);const observer=new ResizeObserver(resize);observer.observe(header);resize();return()=>observer.disconnect()},[]);
  React.useLayoutEffect(()=>{if(!expanded)root.current?.scrollIntoView({block:'start'})},[expanded]);
  React.useEffect(()=>{const changed=()=>{const selected=initial();select(selected);const requested=new URLSearchParams(location.hash.slice(1)).get('view');if(requested&&requested!==selected)location.hash=`view=${encodeURIComponent(selected)}`};changed();addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed)},[archive,candidates,availability,defaultView,select]);
  const choose=React.useCallback((name:string)=>{select(name);location.hash=`view=${encodeURIComponent(name)}`},[select]);
  React.useEffect(()=>{
    const host=cardsHost.current!,container=root.current!;
    const controller=new AbortController();
    const grid=document.createElement('div');grid.className='thumb-grid';host.append(grid);
    const data=document.createElement('script');data.type='application/json';data.id='snapshot-output-groups';data.textContent=JSON.stringify(outputGroups);host.append(data);
    const cards:HTMLElement[]=[];
    const resourcePreviews=new Map<string,()=>void>();
    const embedURL=(name:string)=>{
      const target=new URL(location.href);target.search='';target.hash='';
      target.searchParams.set('embed','1');target.searchParams.set('capture',capture.id);target.searchParams.set('view',name);
      if(archive.sourceUrl)target.searchParams.set('source',archive.sourceUrl);
      return target.href;
    };
    for(const name of names){
      const card=document.createElement('div');card.className='thumb-card';card.dataset.pluginName=name;card.dataset.outputGroup=presentation(name).snapshot_output_group||'other';
      card.dataset.outputSize='0';
      const body=document.createElement('div');body.className='thumb-body';
      const heading=document.createElement('a');heading.href=`#view=${name}`;heading.target='preview';heading.title=pluginName(name);
      const title=document.createElement('h4');const icon=document.createElement('span');icon.className='card-title-icon';icon.innerHTML=pluginIcon(name);title.append(icon,document.createTextNode(` ${name}`));heading.append(title);
      const actions=document.createElement('div');actions.className='thumb-actions';
      const folder=document.createElement('a');folder.href=`#view=${name}${name==='responses'?'':'&files=1'}`;folder.title='Open output folder';folder.dataset.noPreview='1';folder.textContent='📁';actions.append(folder);
      const open=document.createElement('a');open.href=embedURL(name);open.target='_blank';open.rel='noopener';open.title='Open output in a new tab';open.dataset.noPreview='1';open.textContent='↗';actions.append(open);body.append(actions,heading);
      const thumbnail=document.createElement('div');thumbnail.className='card-img-top thumbnail-wrapper';
      const overlay=document.createElement('a');overlay.className='thumbnail-click-overlay';overlay.href=heading.href;overlay.target='preview';overlay.setAttribute('aria-label',`Preview ${pluginName(name)}`);
      const frame=document.createElement('iframe');frame.dataset.pluginPreview=name;frame.className='card-img-top';frame.title=`${pluginName(name)} preview`;frame.loading='lazy';frame.tabIndex=-1;
      const screenshot=name==='screenshot'?archive.artifact('screenshot'):undefined;
      const template=cardTemplate(name)||'';
      if(name==='papersdl'){
        thumbnail.innerHTML=template;thumbnail.prepend(overlay);
      }else if(name==='responses'||name==='liteparse'||name==='gallerydl'||name==='ytdlp'){
        const preview=document.createElement('div');preview.dataset.resourcePreview=name;preview.textContent='Loading…';preview.style.cssText='width:100%;height:100%;overflow:hidden';thumbnail.append(overlay,preview);
        // The same DOM preview is cloned onto stack covers, without another
        // document/engine running for each thumbnail iframe.
        resourcePreviews.set(name,()=>{void Promise.resolve(name==='ytdlp'?createYtdlpCardPreview({archive}):name==='gallerydl'?createGalleryCardPreview({archive,capture,signal:controller.signal}):createResourceCardPreview({archive,capture,plugin:name,signal:controller.signal,onUpdate:content=>{if(!controller.signal.aborted)container.querySelectorAll(`[data-resource-preview="${name}"]`).forEach(target=>target.replaceChildren(content.cloneNode(true)))}})).then(content=>{
          if(controller.signal.aborted)return;
          container.querySelectorAll(`[data-resource-preview="${name}"]`).forEach(target=>target.replaceChildren(content.cloneNode(true)));
        }).catch(error=>{if(!controller.signal.aborted)container.querySelectorAll(`[data-resource-preview="${name}"]`).forEach(target=>{target.textContent=String(error)})});});
      }else if(screenshot){const image=document.createElement('img');image.src=recordURL(archive,screenshot);image.alt='Screenshot of page';image.loading='lazy';image.decoding='async';image.className='extractor-thumbnail screenshot-thumbnail';image.style.cssText='display:block;width:100%;height:100%;object-fit:cover;object-position:top center;background:#333;';thumbnail.append(overlay,image)}
      else if(template.includes('<iframe src="{{ output_path }}?preview=1&amp;titlebar=0"')){
        frame.style.cssText='width:100% !important;height:100% !important;transform:none !important;border:0';thumbnail.append(overlay,frame);
      }else{const canonicalFrame=new DOMParser().parseFromString(template,'text/html').querySelector('iframe');if(canonicalFrame)frame.style.cssText=canonicalFrame.getAttribute('style')||'';thumbnail.append(overlay,frame);}card.append(body,thumbnail);grid.append(card);cards.push(card);
    }
    const other=document.createElement('div');other.className='thumb-card';other.dataset.outputGroup='other';other.dataset.otherFiles='';
    other.innerHTML='<div class="thumb-body"><h4><span class="card-title-icon">📦</span> Other files</h4></div><div class="thumbnail-wrapper other-files-preview"><div class="loose-items"></div></div>';
    for(const name of available.filter(name=>!names.includes(name)&&capture.hooks.some(hook=>hook.plugin===name&&hook.records?.length))){const a=document.createElement('a');a.href=`#view=${name}&files=1`;a.dataset.noPreview='1';a.textContent=`📁 ${name}`;a.dataset.pluginView=name;other.querySelector('.loose-items')!.append(a)}
    if(other.querySelector('.loose-items')!.children.length)grid.append(other);
    const activate=(card:HTMLElement)=>{if(card.dataset.pluginName)choose(card.dataset.pluginName)};
    const clicked=(event:MouseEvent)=>{const target=event.target as Element;if(target.closest('[data-no-preview]'))return;const card=target.closest<HTMLElement>('.thumb-card');if(card?.dataset.pluginName){event.preventDefault();activate(card)}};
    container.addEventListener('click',clicked);
    const dispose=initializeOutputStacks(container,activate);
    const disposePreviews=mountCardPreviews(container,{archive,capture,resources:resourcePreviews});
    const selected=cards.find(card=>card.dataset.pluginName===initial());selected?.classList.add('selected-card');
    return()=>{controller.abort();disposePreviews();dispose?.();container.removeEventListener('click',clicked);host.replaceChildren()};
  },[archive,capture,names,available,choose]);
  React.useEffect(()=>{const host=root.current;if(!host)return;host.querySelectorAll<HTMLElement>('.thumb-card[data-plugin-name]').forEach(card=>card.classList.toggle('selected-card',card.dataset.pluginName===panel));},[panel]);
  return <div className={`snapshot-detail snapshot-stacks${expanded?'':' outputs-collapsed'}`} ref={root}>
    <header><SnapshotHeader archive={archive} capture={capture} {...headerProps} expanded={expanded} onToggleOutputs={setExpanded}/><div className="header-bottom" id="snapshot-output-browser" aria-busy={[...checks.values()].some(value=>typeof value!=='boolean')&&resolved?.checks!==checks} hidden={!expanded} ref={cardsHost}/></header>
    <div id="main-frame-wrapper">{opened.map(name=><PluginOutput key={name} archive={archive} capture={capture} name={name} active={name===panel}/>)}</div>
    <details className="capture-diagnostics"><summary>Archive results</summary><CaptureActivity capture={capture}/></details>
  </div>;
}
