import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import {replayHTML} from '../archive/replay';
import readability from '../../abx-plugins/abx_plugins/plugins/readability/templates/full.html?raw';
import defuddle from '../../abx-plugins/abx_plugins/plugins/defuddle/templates/full.html?raw';
import mercury from '../../abx-plugins/abx_plugins/plugins/mercury/templates/full.html?raw';
import readabilityIcon from '../../abx-plugins/abx_plugins/plugins/readability/templates/icon.html?raw';
import defuddleIcon from '../../abx-plugins/abx_plugins/plugins/defuddle/templates/icon.html?raw';
import mercuryIcon from '../../abx-plugins/abx_plugins/plugins/mercury/templates/icon.html?raw';
export type ArticlePlugin='readability'|'defuddle'|'mercury';
const templates={readability,defuddle,mercury};
const icons={readability:readabilityIcon,defuddle:defuddleIcon,mercury:mercuryIcon};
const names={readability:'Readability',defuddle:'Defuddle',mercury:'Mercury'};

/** The on-load behavior from the three canonical full.html templates.
 * Inline template scripts cannot run under extension CSP, so the host calls it. */
export function applyArticleReaderTemplate(doc:Document,plugin:ArticlePlugin,hideTitlebar=false){
  if(!doc.head)return;
  for(const link of doc.querySelectorAll<HTMLAnchorElement>('a[href]')){try{const url=new URL(link.href);if(['http:','https:'].includes(url.protocol)&&url.origin!==location.origin){link.target='_blank';link.rel='noopener noreferrer';}}catch{}}
  for(const img of doc.querySelectorAll<HTMLElement|SVGElement>('img,svg')){
    const maxWidth=img.style.maxWidth;img.style.maxWidth=maxWidth&&maxWidth!=='none'?'min(100%, '+maxWidth+')':'100%';
    for(const dimension of ['width','height'] as const){const value=img.getAttribute(dimension);if(value&&!img.style[dimension])img.style[dimension]=/^\d+(?:\.\d+)?$/.test(value)?value+'px':value;}
    const width=img.style.width,height=img.style.height;
    if(img.tagName==='IMG'&&/^\d+(?:\.\d+)?px$/.test(width)&&/^\d+(?:\.\d+)?px$/.test(height)&&parseFloat(width)>0&&parseFloat(height)>0){img.style.aspectRatio=parseFloat(width)+' / '+parseFloat(height);img.style.height='auto';}
  }
  // Read the exact CSS literal from the unchanged canonical template.
  const match=/style\.textContent=("(?:[^"\\]|\\.)*")/.exec(templates[plugin]);
  if(!match)throw Error(`Canonical ${plugin} reader CSS is missing`);
  const style=doc.createElement('style');style.textContent=JSON.parse(match[1]!);doc.head.append(style);
  if(plugin==='readability'&&hideTitlebar)doc.body.style.paddingTop='4px';
}

export function ArticlePreview({archive,html,url,plugin,onFiles,hideTitlebar=false}:{archive:ArchiveReader;html:string;url:string;plugin:ArticlePlugin;onFiles?:()=>void;hideTitlebar?:boolean}){
  const frame=React.useRef<HTMLIFrameElement>(null);
  const blobs=React.useRef<string[]>([]);
  const [prepared,setPrepared]=React.useState('');const [error,setError]=React.useState('');
  const shell=React.useMemo(()=>templates[plugin].replace('{{ plugin_icon }}',icons[plugin]).replace(/<script>[\s\S]*?<\/script>/g,''),[plugin]);
  React.useEffect(()=>{let current=true;setError('');setPrepared('');void replayHTML(archive,html,url).then(value=>{if(current)setPrepared(value);}).catch(reason=>{if(current)setError(String(reason));});return()=>{current=false;};},[archive,html,url]);
  React.useEffect(()=>()=>{for(const url of blobs.current)URL.revokeObjectURL(url);},[]);
  const bind=React.useCallback(()=>{
    const doc=frame.current?.contentDocument;if(!doc?.body)return;
    const header=doc.querySelector('header');if(header){header.hidden=hideTitlebar;header.style.display=hideTitlebar?'none':'';}
    const files=doc.getElementById('files') as HTMLAnchorElement|null;
    if(files){files.href='#view=responses';files.onclick=event=>{event.preventDefault();if(onFiles)onFiles();else location.hash='view=responses';};}
    for(const id of ['download','raw']){
      const link=doc.getElementById(id) as HTMLAnchorElement|null;if(!link)continue;
      link.href='#';link.onclick=event=>{
        event.preventDefault();
        const blob=URL.createObjectURL(new Blob([id==='raw'?html:prepared],{type:id==='raw'?'text/plain;charset=utf-8':'text/html;charset=utf-8'}));blobs.current.push(blob);
        const action=document.createElement('a');action.href=blob;
        if(id==='download')action.download=plugin+'.html';else{action.target='_blank';action.rel='noopener noreferrer';}
        action.click();
      };
    }
    const reader=doc.getElementById('reader') as HTMLIFrameElement|null;if(!reader||!prepared)return;
    reader.onload=()=>{try{if(reader.contentDocument)applyArticleReaderTemplate(reader.contentDocument,plugin,hideTitlebar);}catch(reason){setError(String(reason));}};
    if(reader.srcdoc!==prepared)reader.srcdoc=prepared;
  },[prepared,html,plugin,onFiles,hideTitlebar]);
  React.useEffect(()=>{bind();},[bind]);
  if(error)return <p className="error">{error}</p>;
  return <iframe ref={frame} title={`${names[plugin]} full view`} className="document-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={shell} onLoad={bind}/>;
}
