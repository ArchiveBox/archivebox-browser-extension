import {extractArchivedYtdlp} from '@/vendor/yt-dlp/offline';
import type {ArchiveEntry,ArchiveReader} from '@/src/archive/reader';
import type {ViewContext,ViewResult} from '@/src/archive/views';
import {streamKind,streamPlan} from '../../media/browser/streams';
import {formatResources,mediaMime} from '@/vendor/yt-dlp/media';
import type {MediaAssembly,MediaInput} from '@/vendor/yt-dlp/ffmpeg';
export type YtdlpFile={path:string;mime:string;entry?:ArchiveEntry;content?:string;size?:number;subtitle?:boolean;stream?:'hls'|'dash';assembly?:MediaAssembly};
export type YtdlpPresentation={type:'ytdlp';files:YtdlpFile[]};
const clean=(value:string)=>value.replace(/[\\/\u0000-\u001f]/g,'_');
const extension=(entry:ArchiveEntry)=>new URL(entry.url).pathname.split('.').at(-1)?.toLowerCase()||entry.mime.split('/').at(-1)||'bin';
export function capturedMedia(archive:ArchiveReader){
 return [...new Map(archive.entries.filter(entry=>entry.status===200&&/^(video|audio)\//.test(entry.mime)&&!streamKind(entry.url,entry.mime)&&! /\.(?:ts|m4s)(?:[?#]|$)/i.test(entry.url)).map(entry=>[entry.url,entry])).values()];
}
async function derive({archive,url,signal}:ViewContext):Promise<ViewResult>{
 const plugin=archive.metadata?.plugins.find((plugin:any)=>plugin.id==='ytdlp'),hook=plugin?.hooks[0],files:YtdlpFile[]=[],used=new Set<string>();
 const data=hook?.data as {userAgent?:string;supported?:boolean;tracks?:any[]}|undefined;
 const available=capturedMedia(archive);
 const add=(path:string,entry:ArchiveEntry,extra:Partial<YtdlpFile>={})=>{files.push({path,mime:entry.mime,entry,...extra});used.add(entry.url)};
 const archived=async(target:string):Promise<ArchiveEntry|undefined>=>{
  const seen=new Set<string>();
  while(target&&!seen.has(target)){
   seen.add(target);const entry=archive.entries.filter(entry=>entry.url===target&&entry.status>=200&&entry.status<400).at(-1);if(!entry)return;
   if(entry.status<300)return entry;
   const record=await archive.headers(entry),location=record.headers.location;if(!location)return;target=new URL(location,target).href;
  }
 };
 // The acquisition outcome already proves an unsupported URL. Do not launch
 // another interpreter merely to draw its empty player or file badge.
 if(hook&&data?.supported!==false&&hook.records?.length){
  const extracted:any=await extractArchivedYtdlp(archive,url,Number(plugin.config?.YTDLP_PLAYLIST_LIMIT||20),hook.records,data?.userAgent,signal,String(plugin.config?.YTDLP_FORMAT||'bv*+ba/b'));
  const videos:any[]=[],playlists:any[]=[];
  const walk=(info:any)=>{if(info?.entries){playlists.push(info);info.entries.forEach(walk)}else if(info)videos.push(info)};walk(extracted.info);
  for(const playlist of playlists)files.push({path:clean(playlist.id||'playlist')+'.info.json',mime:'application/json',content:JSON.stringify(playlist,null,2)});
  for(const [index,video]of videos.entries()){
   const base=clean(video.id||String(index+1));
   files.push({path:base+'.info.json',mime:'application/json',content:JSON.stringify(video,null,2)});
   if(video.description)files.push({path:base+'.description',mime:'text/plain',content:video.description});
   const preferred=video.requested_formats||video.requested_downloads||[video];let found=false;
   const inputs:MediaInput[]=[];
   for(const format of preferred){
    let resources:{url:string}[];
    try{resources=formatResources(format)}catch{continue}
    const entries=await Promise.all(resources.map(resource=>archived(resource.url)));
    if(entries.some(entry=>!entry||streamKind(entry.url,entry.mime)))continue;
    if(entries.length)inputs.push({entries:entries as ArchiveEntry[],ext:format.ext||'bin',acodec:format.acodec,vcodec:format.vcodec});
   }
   if(inputs.length===preferred.length&&(inputs.length>1||inputs.some(input=>input.entries.length>1))){
    const ext=video.ext||'mkv';
    files.push({path:base+'.'+ext,mime:mediaMime(ext),assembly:{inputs,ext}});
    for(const input of inputs)for(const entry of input.entries)used.add(entry.url);
    for(const format of preferred)if(format.manifest_url)used.add(format.manifest_url);
    found=true;
   }
   if(!found)for(const format of preferred)if(format.url){const entry=await archived(format.url);if(entry){const stream=streamKind(entry.url,entry.mime);if(stream||/^(audio|video)\//.test(entry.mime)||/\.(?:mp4|webm|mp3|m4a|ogg|wav)(?:[?#]|$)/i.test(entry.url)){add(base+'.'+(stream||format.ext||extension(entry)),entry,stream?{stream}:{});found=true;}}}
   if(!found)for(const format of [...video.formats||[]].reverse())if(format.url){const entry=await archived(format.url);if(entry){const stream=streamKind(entry.url,entry.mime);add(base+'.'+(stream||format.ext||extension(entry)),entry,stream?{stream}:{});break;}}
   for(const track of data?.tracks||[])if(track.video===video.id){
    const path=base+'.'+track.kind+'.'+track.language+'.'+track.ext,entry=track.ref&&archive.find(track.ref.url,track.ref.ts);
    if(entry)add(path,entry,{subtitle:true});
    else if(track.status==='derived'){
     const choices=(track.kind==='manual'?video.subtitles:video.automatic_captions)?.[track.language]||[];
     const source=choices.find((item:any)=>item.ext===track.ext&&!item.url&&typeof item.data==='string');if(source)files.push({path,mime:'text/plain',content:source.data,subtitle:true});
    }
   }
   for(const thumbnail of [video.thumbnail,...(video.thumbnails||[]).map((item:any)=>item.url)].filter(Boolean)){
    const entry=await archived(thumbnail);if(entry&&entry.mime.startsWith('image/')){add(base+'.'+extension(entry),entry);break;}
   }
  }
 }
 const manifests=archive.entries.filter(entry=>entry.status===200&&streamKind(entry.url,entry.mime)),dependencies=new Set<string>();
 for(const entry of manifests){signal?.throwIfAborted();const record=await archive.read(entry),metadata=JSON.parse(record.warcHeaders['WARC-JSON-Metadata']||'{}');const plan=streamPlan(new TextDecoder().decode(record.body),entry.url,streamKind(entry.url,entry.mime)!,metadata);plan.urls.forEach(url=>dependencies.add(url));}
 for(const entry of manifests)if(!dependencies.has(entry.url)&&!used.has(entry.url))add(clean(new URL(entry.url).pathname.split('/').at(-1)||'stream'),entry,{stream:streamKind(entry.url,entry.mime)!});
 for(const entry of available)if(!dependencies.has(entry.url)&&!used.has(entry.url))add(clean(decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1)||'media')) ,entry);
 return {title:'YT-DLP',summary:'',sections:[],presentation:{type:'ytdlp',files}};
}
export default function view(context:ViewContext):Promise<ViewResult>{
 context.signal?.throwIfAborted();return derive(context);
}
