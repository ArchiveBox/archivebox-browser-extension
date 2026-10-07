import requestsAdapter from '../python/requests.py?raw';
import {loadPyodide} from 'pyodide';
import bridge from './bridge.py?raw';
import pipeline from './pipeline.py?raw';
import packages from './packages.json';
import type {ExtractorRequest} from '@/vendor/python/transport';
export type ForumTransport={request:ExtractorRequest;log:(message:string)=>void};
export type ForumItem={path:string[];url:string;origin:string;data:Record<string,any>};
export type Board=ForumItem&{title:string};
export type Thread=Board;
export type Post=ForumItem&{subpath:string[];author:string;creation_time:string|null;content:string};
export type File=ForumItem&{subpath:string[];content_type:string|null};
export type Extraction={version:string;modules:string[];extractor_classes:string[];family:string;boards:Board[];threads:Thread[];posts:Post[];files:File[];complete:boolean;error?:string;warnings:string[]};
export async function extractForum(url:string,transport:ForumTransport,options:{timeout?:number;files?:boolean}={}):Promise<Extraction>{
  if(!('Suspending' in WebAssembly))throw Error('forum-dl requires Chromium with WebAssembly JSPI support');
  const assetRoot=(self as typeof self&{archiveboxAssetRoot?:string}).archiveboxAssetRoot||new URL('/',self.location.href).href;
  let phase=performance.now();
  const wheelPaths=[...packages.filter(pkg=>pkg.loader==='wheel').map(pkg=>'forum-dl/'+pkg.filename),
    ...['certifi-2026.1.4-py3-none-any.whl','charset_normalizer-3.4.4-py3-none-any.whl','idna-3.11-py3-none-any.whl','urllib3-2.6.3-py3-none-any.whl','requests-2.32.5-py3-none-any.whl'].map(filename=>'gallery-dl/'+filename),
    'forum-dl/forum_dl-0.3.0-py3-none-any.whl'];
  const [py,wheels]=await Promise.all([
    loadPyodide({indexURL:new URL('pyodide/',assetRoot).href,stdout:message=>{if(message.trim())transport.log(message);},stderr:transport.log}),
    Promise.all(wheelPaths.map(async path=>{const response=await fetch(new URL(path,assetRoot));if(!response.ok)throw Error('Bundled forum-dl dependency: '+response.status);return response.arrayBuffer()})),
  ]);
  performance.measure('forum:interpreter',{start:phase});phase=performance.now();
  await py.loadPackage(['ssl',...packages.filter(pkg=>pkg.loader==='pyodide').map(pkg=>new URL('forum-dl/'+pkg.filename,assetRoot).href)]);
  for(const wheel of wheels)py.unpackArchive(wheel,'zip',{extractDir:'/lib/python3.13/site-packages'});
  performance.measure('forum:packages',{start:phase});phase=performance.now();
  py.FS.writeFile('/lib/python3.13/site-packages/archivebox_forum_pipeline.py',pipeline);
  py.FS.writeFile('/lib/python3.13/site-packages/archivebox_requests.py',requestsAdapter);
  py.registerJsModule('archivebox_transport',transport);
  await py.runPythonAsync(bridge);
  performance.measure('forum:imports',{start:phase});phase=performance.now();
  py.globals.set('archivebox_url',url);py.globals.set('archivebox_timeout',options.timeout??20);py.globals.set('archivebox_files',options.files??true);
  const result=JSON.parse(await py.runPythonAsync('archivebox_extract(archivebox_url, archivebox_timeout, archivebox_files)'));
  performance.measure('forum:traversal',{start:phase});return result;
}
