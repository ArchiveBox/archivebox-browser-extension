import React from 'react';
import type { ArchiveReader, ArchiveEntry } from '../archive/reader';
import type { ViewResult, ViewSection } from '../archive/views';
import { mountReplay, recordURL, replayHTML } from '../archive/replay';
import { StreamPreview } from './StreamPreview';
import { ArticlePreview } from './ArticlePreview';
import {GalleryPreview} from './GalleryPreview';
import {ForumPreview} from './ForumPreview';
import {PaperPreview} from './PaperPreview';
import pdfTemplate from '../../vendor/archivebox/plugins/pdf/full.html?raw';
import {DocumentPreview} from './DocumentPreview';
import {ResponsesPreview} from './ResponsesPreview';
import {CanonicalDataPreview} from './CanonicalDataPreview';
import {GitPreview} from './GitPreview';
import {YtdlpPreview} from './YtdlpPreview';
import {LazyPDFPreview} from './LazyPDFPreview';

export function HTMLPreview({ archive, html, url, standalone=false }: { archive: ArchiveReader; html: string; url: string; standalone?:boolean }) {
  const [prepared, setPrepared] = React.useState('');
  const [error, setError] = React.useState('');
  React.useEffect(() => { let current = true;
    setError('');setPrepared('');
    if(standalone)setPrepared(html);
    else void replayHTML(archive, html, url).then(result => { if(current)setPrepared(result); }).catch(error=>setError(String(error)));
    return () => {current=false;};
  }, [archive, html, url, standalone]);
  if(error)return <p className="error">{error}</p>;
  return <iframe title="Offline document" className="document-frame" sandbox="allow-same-origin" srcDoc={prepared}/>;
}
export function ResourcePreview({ archive, entry }: { archive: ArchiveReader; entry: ArchiveEntry }) {
  const [data,setData]=React.useState<{src:string;text?:string;mime:string}>();
  const [error,setError]=React.useState('');
  React.useEffect(()=>{let current=true;
    setError('');setData(undefined);
    void mountReplay(archive).then(()=>archive.headers(entry)).then(async record=>{const mime=record.headers['content-type']?.split(';')[0]||entry.mime;const text=/json|text|xml|javascript/.test(mime)?await archive.text(entry):undefined;if(current)setData({src:recordURL(archive,entry),mime,text});}).catch(e=>setError(String(e)));
    return ()=>{current=false};
  },[archive,entry]);
  if(error)return <p className="error">{error}</p>; if(!data)return <p>Reading archived record…</p>;
  if(data.mime==='application/pdf')return <PaperPreview archive={archive} entry={entry} markup={pdfTemplate}/>;
  return <div><a className="button subtle" href={data.src} download={entry.url.split('/').at(-1)||'resource'} onClick={async event=>{
    event.preventDefault();
    try {
      const record=await archive.read(entry);
      const download=URL.createObjectURL(new Blob([record.body as BlobPart],{type:data.mime}));
      const link=document.createElement('a');link.href=download;link.download=entry.url.split('/').at(-1)||'resource';link.click();
      setTimeout(()=>URL.revokeObjectURL(download),60000);
    } catch(error){setError(String(error));}
  }}>Download this record</a>
    {data.mime.startsWith('image/')?<img className="archived-image" src={data.src} alt="Archived capture"/>:data.mime.startsWith('video/')?<video controls src={data.src}/>:data.mime.startsWith('audio/')?<audio controls src={data.src}/>:data.text?<pre>{data.text}</pre>:<p>{entry.mime} · {entry.length.toLocaleString()} compressed bytes</p>}
  </div>;
}
function Section({section,archive,url}:{section:ViewSection;archive:ArchiveReader;url:string}){
 return <section className="view-section"><h3>{section.title}</h3>
 {section.type==='table'?<div className="table-scroll"><table><thead><tr>{section.columns.map((v,i)=><th key={i}>{v}</th>)}</tr></thead><tbody>{section.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{String(cell??'—')}</td>)}</tr>)}</tbody></table></div>
 :section.type==='json'?<pre>{JSON.stringify(section.data,null,2)}</pre>
 :section.type==='text'?<pre className="prose">{section.text}</pre>
 :section.type==='article'?<ArticlePreview archive={archive} html={section.html} url={url} plugin={section.plugin}/>:section.type==='html'?<HTMLPreview archive={archive} html={section.html} url={url}/>

 :section.type==='stream'?<StreamPreview archive={archive} entry={section.entry} kind={section.kind}/>
 :<ResourcePreview archive={archive} entry={section.entry}/>}</section>
}
export const Viewer=React.memo(function Viewer({view,archive,url}:{view:ViewResult;archive:ArchiveReader;url:string}){
 if(view.presentation?.type==='lazy-pdf')return <LazyPDFPreview archive={archive} url={url} landscape={view.presentation.landscape}/>;
 if(view.presentation?.type==='git')return <GitPreview presentation={view.presentation}/>;
 if(view.presentation?.type==='canonical')return <CanonicalDataPreview archive={archive} presentation={view.presentation}/>;
 if(view.presentation?.type==='responses')return <ResponsesPreview archive={archive}/>;
 if(view.presentation?.type==='ytdlp')return <YtdlpPreview archive={archive} presentation={view.presentation}/>;
 if(view.presentation?.type==='forum')return <ForumPreview archive={archive} presentation={view.presentation} url={url}/>;
 if(view.presentation?.type==='paper')return <PaperPreview archive={archive} entry={view.presentation.entry}/>;
 if(view.presentation?.type==='gallery')return <GalleryPreview archive={archive} presentation={view.presentation}/>;
 if(view.presentation?.type==='documents')return <DocumentPreview archive={archive} documents={view.presentation.documents}/>;
 const article=view.sections.find(section=>section.type==='article');
 if(article?.type==='article')return <ArticlePreview archive={archive} html={article.html} url={url} plugin={article.plugin}/>;
 return <><h2>{view.title}</h2><p className="muted">{view.summary}</p>{view.sections.map((section,i)=><Section key={i} section={section} archive={archive} url={url}/>)}</>;
});
