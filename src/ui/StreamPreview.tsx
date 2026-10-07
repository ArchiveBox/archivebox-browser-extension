import {playerURL} from '@/src/replay/client';
import React from 'react';
import type {ArchiveReader,ArchiveEntry} from '../archive/reader';
import {mountReplay,recordURL,replayURL} from '../archive/replay';
/** Both canonical and standalone players use the same archived stream boundary. */
export async function attachArchivedStream(video:HTMLVideoElement,archive:ArchiveReader,entry:ArchiveEntry,kind:'hls'|'dash',onError:(message:string)=>void):Promise<()=>void>{
 const archived=(url:string)=>{if(url.startsWith(playerURL(`w/${archive.captureId}/`)))return url;const original=new URL(url,entry.url);if(!/^https?:$/.test(original.protocol))throw Error('Unexpected stream resource protocol');return replayURL(archive,original.href,entry.timestamp,'mp_')};
 await mountReplay(archive);
 if(kind==='hls'){
  const {default:Hls}=await import('hls.js');if(!Hls.isSupported())throw Error('HLS MediaSource playback is unavailable in this browser');
  const player=new Hls({enableWorker:false,autoStartLoad:true,xhrSetup:(xhr,url)=>{xhr.open('GET',archived(url),true)}});
  player.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)onError(`${data.type}: ${data.details}`)});player.loadSource(recordURL(archive,entry,'mp_'));player.attachMedia(video);return()=>player.destroy();
 }
 const {MediaPlayer}=await import('dashjs'),player=MediaPlayer().create();
 player.addRequestInterceptor(async request=>{request.url=archived(request.url);return request});player.on('error',event=>onError(JSON.stringify(event)));player.clearDefaultUTCTimingSources();player.initialize(video,recordURL(archive,entry,'mp_'),false);return()=>player.reset();
}
export function StreamPreview({archive,entry,kind}:{archive:ArchiveReader;entry:ArchiveEntry;kind:'hls'|'dash'}){
 const video=React.useRef<HTMLVideoElement>(null),[error,setError]=React.useState('');
 React.useEffect(()=>{let current=true,destroy:(()=>void)|undefined;setError('');
  if(video.current)void attachArchivedStream(video.current,archive,entry,kind,message=>{if(current)setError(message)}).then(dispose=>{if(current)destroy=dispose;else dispose()}).catch(error=>{if(current)setError(String(error))});
  return()=>{current=false;destroy?.()};
 },[archive,entry,kind]);
 return <div><video ref={video} controls preload="metadata" aria-label="Archived stream"/>{error&&<p className="error">{error}</p>}</div>;
}
