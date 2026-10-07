import React from 'react';
import {md5} from 'hash-wasm';
import type {ArchiveReader} from '../archive/reader';
import type {Capture} from '../capture/types';
import {recordURL} from '../archive/replay';
import {playerURL} from '../replay/client';

export type SnapshotHeaderProps={
  archive:ArchiveReader;
  capture:Capture;
  captures?:Capture[];
  onSelectCapture?:(capture:Capture)=>void|Promise<void>;
  onDownload?:()=>void|Promise<void>;
  onIndex?:()=>void;
  expanded:boolean;
  onToggleOutputs:(expanded:boolean)=>void;
};
const headerStorageKey='archivebox-snapshot-header-visible';
// Canonical archivebox/misc/logging_util.py: printable_filesize.
export function formatSize(size=0) {
  for(const unit of ['Bytes','KB','MB','GB']) {
    if(size>-1024&&size<1024)return `${size.toFixed(1)} ${unit}`;
    size/=1024;
  }
  return `${size.toFixed(1)} TB`;
}
const pad=(value:number)=>String(value).padStart(2,'0');
function dateParts(created:number) {
  const value=new Date(created);
  const date=`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
  return {year:value.getFullYear(),date,timestamp:`${date} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`};
}
function sameURL(value:string) {try{const url=new URL(value);url.hash='';return url.href;}catch{return value;}}

/** React port of the rendered canonical snapshot.html .header-top markup.
 * Source: vendor/archivebox/snapshot.html, including its copy/collapse handlers.
 * WACZ callbacks replace server index, capture and download routes only. */
export function SnapshotHeader({archive,capture,captures=[],onSelectCapture,onDownload,onIndex,expanded,onToggleOutputs}:SnapshotHeaderProps) {
  const url=capture.finalUrl||capture.url;
  const selectedDate=dateParts(capture.created);
  const related=[...new Map([...captures,capture].filter(item=>sameURL(item.finalUrl||item.url)===sameURL(url)).map(item=>[item.id,item])).values()].sort((a,b)=>b.created-a.created);
  const years=[...new Set(related.map(item=>dateParts(item.created).year))].sort((a,b)=>a-b);
  const size=archive.size||capture.size||0;
  const desktopSize=formatSize(size);
  const [number,unit]=desktopSize.split(' ');
  const mobileSize=['MB','KB','Bytes'].includes(unit!)?`${Math.round(Number(number))} ${unit==='Bytes'?'B':unit}`:desktopSize;
  const succeeded=capture.hooks.filter(hook=>hook.status==='succeeded').length;
  const failed=capture.hooks.filter(hook=>hook.status==='failed'||hook.status==='killed').length;
  const favicon=archive.entries.find(entry=>/favicon|apple-touch-icon/.test(entry.url)&&entry.mime.startsWith('image/'));
  const [faviconFailed,setFaviconFailed]=React.useState(false);
  React.useEffect(()=>setFaviconFailed(false),[favicon?.url,capture.id]);
  const [copyState,setCopyState]=React.useState<'idle'|'copied'|'failed'>('idle');
  const copyTimer=React.useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  React.useEffect(()=>{setCopyState('idle');return()=>clearTimeout(copyTimer.current);},[url]);
  const copyLabel=copyState==='copied'?'URL copied':copyState==='failed'?'Could not copy URL. Select the URL to copy it manually.':'Copy original URL';
  const copy=async()=>{
    clearTimeout(copyTimer.current);
    try {await navigator.clipboard.writeText(url);setCopyState('copied');copyTimer.current=setTimeout(()=>setCopyState('idle'),2000);}
    catch {setCopyState('failed');}
  };
  React.useEffect(()=>{
    try {const saved=localStorage.getItem(headerStorageKey);if(saved!==null)onToggleOutputs(saved==='true');}
    catch { /* Canonical header continues to work when storage is unavailable. */ }
  },[onToggleOutputs]);
  const toggle=(event:React.MouseEvent<HTMLDivElement>)=>{
    const target=event.target as Element;
    if(!target.closest('.header-toggle')&&target.closest('a, button, input, select, textarea, details, [role="button"]'))return;
    event.preventDefault();const next=!expanded;
    try{localStorage.setItem(headerStorageKey,String(next));}catch{}
    onToggleOutputs(next);
  };
  const rawTags:unknown=archive.metadata?.tags??archive.manifest?.tags;
  const tagNames=React.useMemo(()=>Array.isArray(rawTags)?rawTags.map(tag=>typeof tag==='string'?tag:typeof tag?.name==='string'?tag.name:'').filter(Boolean).sort():[],[rawTags]);
  const [tagStyles,setTagStyles]=React.useState<Record<string,React.CSSProperties>>({});
  React.useEffect(()=>{
    let current=true;
    // Canonical archivebox/core/widgets.py: TagEditorWidget._tag_style.
    void Promise.all(tagNames.map(async name=>{
      const digest=await md5(name.trim().toLowerCase());const hue=parseInt(digest.slice(0,4),16)%360;
      return [name,{'--tag-bg':`hsl(${hue}, 70%, 92%)`,'--tag-border':`hsl(${hue}, 60%, 82%)`,'--tag-fg':`hsl(${hue}, 35%, 28%)`} as React.CSSProperties] as const;
    })).then(styles=>{if(current)setTagStyles(Object.fromEntries(styles));});
    return()=>{current=false;};
  },[tagNames]);
  return <div className="header-top" onClick={toggle}>
    <div className="header-nav">
      <div className="header-col header-left">
        <a href={location.pathname} className="header-archivebox" title="Go to Index..." onClick={onIndex?event=>{event.preventDefault();onIndex();}:undefined}>
          <img src={playerURL('archive.png')} alt="Archive Icon"/>ArchiveBox
        </a>
      </div>
      <div className="header-col header-main">
        <div className="header-url">
          <div className="header-url-location">
            <span className="header-url-favicon">
              {favicon&&!faviconFailed?<img src={recordURL(archive,favicon)} onError={()=>setFaviconFailed(true)} alt="Favicon" className="favicon"/>:
                <svg className="favicon" role="img" aria-label="Favicon" viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.4"><circle cx="10" cy="10" r="7.25"/><ellipse cx="10" cy="10" rx="3.25" ry="7.25"/><line x1="2.75" y1="10" x2="17.25" y2="10"/></svg>}
            </span>
            <div className="header-url-content">
              <span className="header-page-link">
                <a className="header-url-text" href={url} title={url} target="_blank" rel="noreferrer">{url}</a>
                <span className="header-page-metadata">
                  <span className="header-text-dot" aria-hidden="true">·</span>
                  <span className="header-title-text" title={capture.title}>{capture.title}</span>
                  {tagNames.length>0&&<><span className="header-text-dot header-tags-dot" aria-hidden="true">·</span><span className="header-tags">{tagNames.map((name,index)=><span key={`${name}-${index}`} className="tag-pill" style={tagStyles[name]} title={name}>{name}</span>)}</span></>}
                </span>
              </span>
            </div>
          </div>
          <div className="header-url-actions">
            {!archive.sourceUrl&&<span className="badge permission-pill" title="Private" aria-label="Private">🔒<span className="permission-text"> private</span></span>}
            <div className="header-url-tools">
              <button type="button" className={`header-url-action${copyState==='copied'?' copied':''}`} id="copy-original-url" data-url={url} aria-label={copyLabel} title={copyLabel} onClick={()=>void copy()}>
                <svg className="copy-symbol" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="11" rx="2"/><path d="M12 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>
                <svg className="copy-success" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>
              </button>
              <a className="header-url-action" href={url} target="_blank" rel="noreferrer" aria-label="Open original URL" title="Open original URL in a new tab">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><ellipse cx="10" cy="10" rx="3.5" ry="8"/><path d="M2 10h16"/></svg>
              </a>
              <a className="header-url-action" href={`https://web.archive.org/web/${url}`} target="_blank" rel="noreferrer" aria-label="Search Archive.org" title="Search for this URL in Archive.org">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m2 6 8-4 8 4H2Zm0 12h16M3 15h14M4 8v5m4-5v5m4-5v5m4-5v5"/></svg>
              </a>
              {onDownload&&<button type="button" className="header-url-action header-url-download" aria-label="Download WACZ" title="Download the entire capture as WACZ" onClick={()=>void onDownload()}>
                <span className="header-status" title="Snapshot hook outcomes">
                  {(succeeded>0||failed>0)&&<><span className="status-count status-count-success" title={`${succeeded} succeeded`}>{succeeded}</span>{failed>0&&<span className="status-count status-count-failed" title={`${failed} failed`}>{failed}</span>}</>}
                </span>
                <span className="header-download-size"><span className="desktop-size">{desktopSize}</span><span className="mobile-size">{mobileSize}</span></span>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v11m-4-4 4 4 4-4M3 13v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg>
              </button>}
            </div>
          </div>
        </div>
      </div>
      <div className="header-capture-row">
        <div className="header-year-badges">
          {years.map(year=>{
            const snapshots=related.filter(item=>dateParts(item.created).year===year),selected=year===selectedDate.year;
            return <div key={year} className={`capture-year${selected?' current-year':''}`} data-year={year}>
              <details className="snapshot-variants year-variants">
                <summary className="badge badge-default" aria-label={selected?`All captures; selected ${selectedDate.date}`:undefined}>
                  <span className="year-label">{year} <span className="year-capture-count">{snapshots.length}</span></span>
                  {selected&&<span className="header-date">{selectedDate.date}</span>}
                </summary>
                <div className="snapshot-variants-list">
                  {(selected?related:snapshots).map(item=><a key={item.id} href={`#capture=${encodeURIComponent(item.id)}`} title={item.finalUrl||item.url} aria-current={item.id===capture.id?'page':undefined} onClick={event=>{
                    event.preventDefault();event.currentTarget.closest('details')?.removeAttribute('open');if(onSelectCapture)void onSelectCapture(item);
                  }}>{dateParts(item.created).timestamp}{' \u00a0 💾 '}{formatSize(item.id===capture.id?size:item.size).replace(' ','\u00a0')}</a>)}
                </div>
              </details>
            </div>;
          })}
        </div>
      </div>
    </div>
    <button type="button" className="header-toggle" aria-label="Toggle saved outputs" aria-expanded={expanded} aria-controls="snapshot-output-browser">{expanded?'▾':'▸'}</button>
  </div>;
}
