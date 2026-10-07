import {extractYtdlp} from '@/vendor/yt-dlp/runtime';
import type {HookContext,RecordRef} from '@/src/capture/types';
import {streamKind,streamPlan} from '../../media/browser/streams';
import {createCaptureTransport,createCapturedTransport} from '@/vendor/python/transport';
import {runExtractorWorker} from '@/vendor/python/worker-client';
import {formatResources} from '@/vendor/yt-dlp/media';

export default async function(ctx:HookContext) {
  // Canonical folder_download_plugin: provider plugins own container downloads.
  const source=new URL(ctx.url);let folderProvider:string|undefined;
  if(/^https?:$/.test(source.protocol)&&!source.username&&!source.password){
    if(source.hostname==='drive.google.com'&&(/^\/drive\/(?:u\/\d+\/)?folders\/[\w-]+\/?$/.test(source.pathname)||(source.pathname==='/folderview'&&source.searchParams.get('id'))))folderProvider='gdrive';
    if(['www.dropbox.com','dropbox.com'].includes(source.hostname)&&!source.searchParams.get('preview')&&(source.pathname.startsWith('/scl/fo/')||/^\/sh\/[^/]+\/[^/]+\/?$/.test(source.pathname)))folderProvider='dropbox';
  }
  if(folderProvider)return {status:'noresults' as const,summary:'Folder download belongs to '+folderProvider};
  if(!('Suspending' in WebAssembly))throw Error('yt-dlp requires Chromium with WebAssembly JSPI support');
  const problems:string[]=[],tracks:any[]=[],videos:any[]=[];
  const maxBytes=Number(ctx.config.YTDLP_MAX_MB||256)*1024*1024,maxRequests=Number(ctx.config.YTDLP_MAX_REQUESTS||1000);
  const {request,records}=createCaptureTransport(ctx,{maxBytes,maxRequests});
  const options={playlistLimit:Number(ctx.config.YTDLP_PLAYLIST_LIMIT||20),format:String(ctx.config.YTDLP_FORMAT||'bv*+ba/b')};
  let extracted:any;
  try {
    extracted=await extractYtdlp(ctx.url,options,{request,log:ctx.log,solve:ctx.solveYtdlpChallenge});
    if(extracted.supported===false){
      const recorded=await createCapturedTransport(ctx,records);
      const offline=await runExtractorWorker<{supported:boolean}>('ytdlp',[ctx.url,options,extracted.userAgent],{request:recorded,log:ctx.log,solve:ctx.solveYtdlpChallenge},ctx.signal);
      if(recorded.failures.length||offline.supported!==false)throw Error('Recorded media applicability differs from acquisition');
      return {status:'noresults' as const,records,summary:'No supported media',data:{version:extracted.version,userAgent:extracted.userAgent,supported:false,tracks:[],selectedFormats:[]}};
    }
    const walk=(info:any)=>{if(info.entries){if(info.playlist_count>info.entries.length)problems.push(`Playlist truncated: ${info.entries.length}/${info.playlist_count}`);for(const entry of info.entries)if(entry)walk(entry);}else videos.push(info);};
    walk(extracted.info);
    for(const video of videos) {
      for(const [kind,groups] of Object.entries({manual:video.subtitles,automatic:video.automatic_captions}))
        for(const [language,formats] of Object.entries(groups||{}))for(const track of (ctx.config.YTDLP_ALL_SUBTITLE_FORMATS===true?formats as any[]:(formats as any[]).slice(-1))) {
          const item:{video:string;kind:string;language:string;ext:string;url:string;status:string;ref?:RecordRef}={video:video.id,kind,language,ext:track.ext,url:track.url||'',status:'pending'};tracks.push(item);
          try {
            if(!track.url&&typeof track.data==='string'){item.status='derived';continue;}
            if(!track.url)throw Error('Subtitle has neither an original URL nor derived inline content');
            const response=await request(track.url,'GET',{...video.http_headers,...track.http_headers},null,30);
            if(response.status<200||response.status>=300)throw Error(`HTTP ${response.status}`);
            if(!response.body.byteLength)throw Error('Empty subtitle response');
            if(/text\/html/i.test(response.headers['content-type']||''))throw Error('HTML returned instead of subtitle content');
            item.status='captured';item.ref=response.ref;
          }catch(error){item.status=String(error);problems.push(String(error));}
        }
      if(ctx.config.YTDLP_FETCH_MEDIA===true) {
        const queue:{url:string;headers:Record<string,string>}[]=[];
        for(const format of video.requested_formats||video.requested_downloads||[video]){
          try{queue.push(...formatResources({...format,http_headers:format.http_headers||video.http_headers}));}
          catch(error){problems.push(String(error));}
        }
        const seen=new Set<string>();
        while(queue.length){const target=queue.shift()!;if(seen.has(target.url))continue;seen.add(target.url);
          try{const response=await request(target.url,'GET',target.headers,null,30);if(response.status<200||response.status>=300)throw Error(`HTTP ${response.status}`);
            const kind=streamKind(response.url,response.headers['content-type']||'');if(kind){const plan=streamPlan(new TextDecoder().decode(response.body),response.url,kind,{});queue.push(...plan.urls.map(url=>({url,headers:target.headers})));problems.push(...plan.unsupported);if(plan.live)problems.push('Only current live stream window captured');}
          }catch(error){problems.push(`${target.url}: ${error}`);break;}
        }
      }
      // Match upstream --write-thumbnail: try preferred artwork first and use
      // lower-ranked originals only when that candidate cannot be acquired.
      for(const thumbnail of [...(video.thumbnails||[])].reverse()){
        if(!thumbnail.url)continue;
        try{const response=await request(thumbnail.url,'GET',{...video.http_headers,...thumbnail.http_headers},null,30);if(response.status>=200&&response.status<300&&response.body.byteLength)break;}
        catch(error){ctx.log(`Thumbnail ${thumbnail.url}: ${error}`);}
      }
    }
    if(!problems.length){
      ctx.log('Verifying upstream extraction using recorded responses only');
      const recorded=await createCapturedTransport(ctx,records);
      await runExtractorWorker('ytdlp',[ctx.url,options,extracted.userAgent],{request:recorded,log:ctx.log,solve:ctx.solveYtdlpChallenge},ctx.signal);
      if(recorded.failures.length)problems.push(...recorded.failures);
    }
  }catch(error){problems.push(String(error));}
  const uniqueProblems=[...new Set(problems)];
  for(const problem of uniqueProblems)ctx.log(problem);
  return {status:problems.length?'failed' as const:'succeeded' as const,records,
    summary:`yt-dlp ${extracted?.version||'2026.8.19'}: ${videos.length} videos, ${tracks.filter(track=>['captured','derived'].includes(track.status)).length}/${tracks.length} subtitles, ${records.length} original responses; ${uniqueProblems.length} incomplete conditions`,
    data:{version:extracted?.version,userAgent:extracted?.userAgent,tracks,problems:uniqueProblems,selectedFormats:videos.map(video=>({id:video.id,extractor:video.extractor_key,format:video.format_id})),limitations:['No native subprocesses, DRM, WebSocket or TLS impersonation']}};
}
