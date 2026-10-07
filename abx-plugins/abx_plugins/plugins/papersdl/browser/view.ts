import type {ViewContext,ViewResult} from '@/src/archive/views';
import type {ArchiveEntry} from '@/src/archive/reader';
import {createPaperRuntime} from '@/vendor/papers-dl/runtime';
import {createArchivedTransport} from '@/vendor/python/transport';

export default async function({archive,url,capture}:ViewContext):Promise<ViewResult>{
  const hook=capture?.hooks.find(hook=>hook.plugin==='papersdl');
  const refs=new Set(hook?.records?.map(ref=>`${ref.url} ${ref.ts}`));
  const originals=archive.entries.filter(entry=>refs.has(`${entry.url} ${entry.ts}`));
  const pdfs:ArchiveEntry[]=[];
  for(const entry of originals)if(entry.mime==='application/pdf'&&entry.status>=200&&entry.status<300){const {body}=await archive.read(entry);if(new TextDecoder().decode(body.slice(0,1024)).includes('%PDF-'))pdfs.push(entry);}
  if(!pdfs.length)return {title:'Academic papers',summary:'',presentation:{type:'paper'},sections:[]};
  if(hook){
    const recorded=await createArchivedTransport(archive,hook.records||[]);
    const runtime=await createPaperRuntime(recorded,()=>{});
    try{
    const html=archive.documentEntry();
    await runtime.parse([String(capture?.pluginConfig?.papersdl?.PAPERSDL_QUERY||''),capture?.url||url,html?await archive.text(html):''].join('\n'));
    for(const entry of pdfs)await runtime.describe((await archive.read(entry)).body);
    if(recorded.failures.length)throw Error('Incomplete archived paper evidence: '+[...new Set(recorded.failures)].join('; '));
    }finally{runtime.dispose();}
  }
  return {title:'Academic papers',summary:'',presentation:{type:'paper',entry:pdfs[0]},sections:[]};
}
