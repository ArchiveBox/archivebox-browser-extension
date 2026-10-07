import requestsAdapter from '../python/requests.py?raw';
import {loadPyodide} from 'pyodide';
import bridge from './bridge.py?raw';
import provenance from './provenance.json';
import type {ExtractorRequest} from '../python/transport';
export type GalleryTransport={request:ExtractorRequest;log:(message:string)=>void;sleep:(seconds:number)=>Promise<void>};
export type GalleryMessage={type:'directory'|'url'|'queue';url:string;metadata:Record<string,any>};
export type GalleryResult={version:string;extractorCount:number;supported:boolean;extractor?:string;messages:GalleryMessage[];errors:string[];files:number};
/** Packaged upstream engine; all site HTTP passes through the recorder adapter. */
export async function extractGallery(url:string,config:Record<string,unknown>,transport:GalleryTransport,download=false):Promise<GalleryResult>{
  if(!('Suspending' in WebAssembly))throw Error('gallery-dl requires Chromium with WebAssembly JSPI support');
  const assetRoot=(self as typeof self&{archiveboxAssetRoot?:string}).archiveboxAssetRoot||new URL('/',self.location.href).href;
  const py=await loadPyodide({indexURL:new URL('pyodide/',assetRoot).href,stdout:transport.log,stderr:transport.log});
  await py.loadPackage('ssl');
  for(const artifact of provenance.distributions){
    const response=await fetch(new URL('gallery-dl/'+artifact.filename,assetRoot));
    if(!response.ok)throw Error(`Bundled gallery-dl dependency: HTTP ${response.status}`);
    py.unpackArchive(await response.arrayBuffer(),'zip',{extractDir:'/lib/python3.13/site-packages'});
  }
  py.FS.writeFile('/lib/python3.13/site-packages/archivebox_requests.py',requestsAdapter);
  py.registerJsModule('archivebox_transport',transport);
  await py.runPythonAsync(bridge);
  py.globals.set('archivebox_url',url);py.globals.set('archivebox_config',JSON.stringify(config));py.globals.set('archivebox_download',download);
  return JSON.parse(await py.runPythonAsync('extract(archivebox_url, archivebox_config, archivebox_download)'));
}
