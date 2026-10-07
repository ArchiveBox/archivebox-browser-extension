import {Parser} from 'm3u8-parser';
import {parse as parseMPD} from 'mpd-parser';
import {ArchiveResponse,rewriteHLS,rewriteDASH} from '@webrecorder/wabac';
export type StreamPlan={kind:'hls'|'dash';urls:string[];segments:number;duration:number;live:boolean;unsupported:string[]};
export const streamKind=(url:string,mime=''):StreamPlan['kind']|undefined=>/mpegurl/i.test(mime)||/\.m3u8(?:[?#]|$)/i.test(url)?'hls':/dash\+xml/i.test(mime)||/\.mpd(?:[?#]|$)/i.test(url)?'dash':undefined;
export function streamPlan(source:string,url:string,kind:StreamPlan['kind'],metadata:Record<string,unknown>={}):StreamPlan {
  const response=new ArchiveResponse({payload:new TextEncoder().encode(source),status:200,headers:new Headers(),url,date:new Date(),extraOpts:metadata});
  const plan:StreamPlan={kind,urls:[],segments:0,duration:0,live:false,unsupported:[]};
  const urls=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string'&&value){const target=new URL(value,url);if(/^https?:$/.test(target.protocol)){target.hash='';urls.add(target.href);}}};
  const segments=(list:any[])=>{
    for(const item of list||[]) {
      if(item.key && item.key.method!=='NONE' && (item.key.method!=='AES-128'||(item.key.keyFormat&&item.key.keyFormat!=='identity'))) {plan.unsupported.push(`Encrypted ${item.key.method} / ${item.key.keyFormat||'unknown'} stream`);continue;}
      add(item.resolvedUri||item.uri); add(item.map?.resolvedUri||item.map?.uri); add(item.key?.uri);
      plan.segments++;plan.duration+=Number(item.duration)||0;
    }
  };
  if(kind==='hls') {
    if(!source.trimStart().startsWith('#EXTM3U'))throw Error('Response is not an HLS playlist');
    // Use exactly the same upstream quality selection as SWReplay. The original
    // master stays unchanged in the WARC; only this transient plan is reduced.
    const parser=new Parser({url});parser.push(rewriteHLS(source,{response}));parser.end();
    const manifest=parser.manifest;
    for(const child of manifest.playlists||[])add(child.uri);
    for(const groups of Object.values(manifest.mediaGroups||{}) as any[])for(const group of Object.values(groups) as any[])for(const rendition of Object.values(group) as any[])add(rendition.uri);
    segments(manifest.segments);plan.live=!!manifest.segments?.length&&!manifest.endList;
    if(manifest.contentSteering)plan.unsupported.push('Content steering requires additional dynamic discovery');
  } else {
    const manifest=parseMPD(rewriteDASH(source,{response}),{manifestUri:url});
    const playlists:any[]=[...(manifest.playlists||[])];
    for(const groups of Object.values(manifest.mediaGroups||{}) as any[])for(const group of Object.values(groups) as any[])for(const rendition of Object.values(group) as any[])playlists.push(...rendition.playlists||[]);
    const seen=new Set<any>();
    for(const playlist of playlists) {
      if(seen.has(playlist))continue;seen.add(playlist);
      if(playlist.contentProtection){plan.unsupported.push('DRM-protected DASH representation');continue;}
      // Preserve the complete original indexed file once. The real DASH player
      // reads SIDX/initialization/segments with Range requests served by wabac.
      if(playlist.sidx) {add(playlist.sidx.resolvedUri||playlist.sidx.uri);add(playlist.sidx.map?.resolvedUri||playlist.sidx.map?.uri);continue;}
      segments(playlist.segments);if(!playlist.endList)plan.live=true;
    }
    if(!plan.segments&&!urls.size)plan.unsupported.push('No enumerable DASH segments or indexed files');
  }
  plan.urls=[...urls];return plan;
}
