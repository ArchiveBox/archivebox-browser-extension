import type {ArchiveEntry,ArchiveReader} from '@/src/archive/reader';
import {mediaMime} from './media';

export type MediaInput={entries:ArchiveEntry[];ext:string;acodec?:string;vcodec?:string};
export type MediaAssembly={inputs:MediaInput[];ext:string};

/** A transient FFmpeg derivation. Inputs are archive bodies only; FFmpeg receives
 * local filenames and has no original-site URLs or network transport. */
export async function assembleArchivedMedia(archive:ArchiveReader,assembly:MediaAssembly,signal:AbortSignal,onProgress:(message:string)=>void):Promise<Blob>{
 signal.throwIfAborted();
 const {FFmpeg}=await import('@ffmpeg/ffmpeg');
 const ffmpeg=new FFmpeg(),logs:string[]=[];
 const abort=()=>ffmpeg.terminate();signal.addEventListener('abort',abort,{once:true});
 ffmpeg.on('log',({message})=>{logs.push(message);if(logs.length>12)logs.shift()});
 ffmpeg.on('progress',({progress})=>onProgress(`Preparing media… ${Math.max(0,Math.min(100,Math.round(progress*100)))}%`));
 try{
  onProgress('Loading FFmpeg…');
  const root=new URL('ytdlp/ffmpeg/',new URL('/',location.href)).href;
  await ffmpeg.load({classWorkerURL:root+'worker/worker.js',coreURL:root+'core/ffmpeg-core.js',wasmURL:root+'core/ffmpeg-core.wasm'});
  signal.throwIfAborted();
  const args:string[]=[];
  for(const [index,input]of assembly.inputs.entries()){
   const names:string[]=[];
   for(const [part,entry]of input.entries.entries()){
    signal.throwIfAborted();onProgress(`Reading archived media… ${index+1}/${assembly.inputs.length}`);
    const name=`input-${index}-${part}.${input.ext.replace(/[^a-z0-9]/gi,'')||'bin'}`;
    // FFmpeg transfers this buffer to its Worker; leave the reader's shared body cache intact.
    await ffmpeg.writeFile(name,(await archive.read(entry)).body.slice());names.push(name);
   }
   if(!names.length)throw Error('No captured media input');
   args.push('-protocol_whitelist','file,concat','-i',names.length===1?names[0]!:'concat:'+names.join('|'));
  }
  // Source port of upstream FFmpegMergerPP.run: preserve selected elementary
  // streams with codec copy, without re-encoding or changing compression.
  args.push('-c','copy');
  for(const [index,input]of assembly.inputs.entries()){
   if(input.acodec!=='none')args.push('-map',`${index}:a:0`);
   if(input.vcodec!=='none')args.push('-map',`${index}:v:0`);
  }
  const ext=assembly.ext.replace(/[^a-z0-9]/gi,'')||'mkv',output='output.'+ext;
  onProgress('Preparing media…');
  const result=await ffmpeg.exec([...args,output]);
  signal.throwIfAborted();
  if(result!==0)throw Error(`FFmpeg exited ${result}: ${logs.join('\n')}`);
  const bytes=await ffmpeg.readFile(output);
  if(typeof bytes==='string')throw Error('FFmpeg returned text for media output');
  return new Blob([bytes as BlobPart],{type:mediaMime(ext)});
 }finally{signal.removeEventListener('abort',abort);ffmpeg.terminate()}
}
