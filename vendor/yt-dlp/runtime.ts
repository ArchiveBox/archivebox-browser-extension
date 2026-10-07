import {loadPyodide} from 'pyodide';
import bridge from './bridge.py?raw';
import type {ExtractorRequest} from '../python/transport';
export type YtdlpTransport={request:ExtractorRequest;log:(message:string)=>void;solve:(source:string)=>Promise<string>};
/** Only packaged interpreter, wheels and adapter code are loaded. Site HTTP goes through transport. */
export async function extractYtdlp(url:string,options:number|{playlistLimit:number;format:string},transport:YtdlpTransport,userAgent?:string){
  const {playlistLimit,format}=typeof options==='number'?{playlistLimit:options,format:'bv*+ba/b'}:options;
  if(!('Suspending' in WebAssembly))throw Error('yt-dlp requires Chromium with WebAssembly JSPI support');
  const assetRoot=(globalThis as typeof globalThis&{archiveboxAssetRoot?:string}).archiveboxAssetRoot||new URL('/',self.location.href).href;
  const root=new URL('pyodide/',assetRoot).href;
  let phase=performance.now();
  const [py,wheels]=await Promise.all([
    loadPyodide({indexURL:root,stdout:transport.log,stderr:transport.log}),
    Promise.all(['yt_dlp-2026.8.19-py3-none-any.whl','yt_dlp_ejs-0.8.0-py3-none-any.whl'].map(async filename=>{
      const response=await fetch(new URL('ytdlp/'+filename,assetRoot));if(!response.ok)throw Error('Bundled yt-dlp wheel: HTTP '+response.status);return response.arrayBuffer();
    })),
  ]);
  performance.measure('ytdlp:interpreter',{start:phase});phase=performance.now();
  await py.loadPackage('ssl');
  for(const wheel of wheels)py.unpackArchive(wheel,'zip',{extractDir:'/lib/python3.13/site-packages'});
  py.registerJsModule('archivebox_transport',transport);
  performance.measure('ytdlp:packages',{start:phase});phase=performance.now();
  await py.runPythonAsync(bridge);
  performance.measure('ytdlp:imports',{start:phase});phase=performance.now();
  py.globals.set('archivebox_url',url);py.globals.set('archivebox_playlist_limit',playlistLimit);
  py.globals.set('archivebox_user_agent',userAgent||'');
  py.globals.set('archivebox_format',format);
  const result=JSON.parse(await py.runPythonAsync('extract(archivebox_url, archivebox_playlist_limit, archivebox_user_agent, archivebox_format)'));
  performance.measure('ytdlp:traversal',{start:phase});return result;
}
