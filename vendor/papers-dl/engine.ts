import requestsAdapter from '../python/requests.py?raw';
import {loadPyodide} from 'pyodide';
import {createSHA256} from 'hash-wasm';
import network from './python/network.py?raw';
import adapt from './python/adapt.py?raw';
import run from './python/run.py?raw';
import packages from './packages.json';
import wasmPackages from './pyodide-packages.json';
import type {ExtractorRequest} from '@/vendor/python/transport';

const sources=import.meta.glob('./upstream/src/**/*.py',{eager:true,query:'?raw',import:'default'}) as Record<string,string>;
const assetRoot=()=> (globalThis as typeof globalThis&{archiveboxAssetRoot?:string}).archiveboxAssetRoot||new URL('/',self.location.href).href;
const asset=(path:string)=>new URL('papers-dl/'+path,assetRoot()).href;
export type PaperRuntime=Awaited<ReturnType<typeof createPaperRuntime>>;

/** Pinned Python implementations, with only network and native MuPDF I/O adapted. */
export async function createPaperRuntime(request:ExtractorRequest,log:(message:string)=>void){
  if(!('Suspending' in WebAssembly))throw Error('papers-dl requires Chromium WebAssembly JSPI support');
  const py=await loadPyodide({indexURL:new URL('pyodide/',assetRoot()).href,stdout:log,stderr:log});
  // Custom wheel URLs omit Pyodide's dependency graph. Load native prerequisites
  // before their dependents so libssl is linked before cryptography's Rust module.
  await py.loadPackage('ssl');
  for(const name of ['pycparser','six','cffi','cryptography'])await py.loadPackage(asset(wasmPackages.find(pkg=>pkg.name===name)!.filename));
  const site='/lib/python3.13/site-packages';
  const hasher=await createSHA256();
  for(const pkg of packages){
    const response=await fetch(asset(pkg.assetFilename||pkg.filename));if(!response.ok)throw Error('Bundled papers-dl dependency: '+pkg.filename+' HTTP '+response.status);
    const bytes=await response.arrayBuffer();
    hasher.init();hasher.update(new Uint8Array(bytes));const digest=hasher.digest('hex');
    if(digest!==pkg.sha256)throw Error('Bundled package hash mismatch: '+pkg.filename);
    py.unpackArchive(bytes,pkg.filename.endsWith('.whl')?'zip':'gztar',{extractDir:site});
    if(pkg.filename.endsWith('.tar.gz'))py.runPython(`import sys; sys.path.insert(0, ${JSON.stringify(site+'/'+pkg.filename.slice(0,-7))})`);
  }
  const mupdf=await import(/* @vite-ignore */asset('mupdf/mupdf.js')) as typeof import('mupdf');
  const mupdf_spans=(bytes:Uint8Array)=>{
    const doc=mupdf.Document.openDocument(bytes,'application/pdf');
    const pages:{blocks:{type:number;lines:{spans:{text:string;size:number;font:string}[]}[]}[]}[]=[];
    try{for(let index=0;index<doc.countPages();index++){
      const page=doc.loadPage(index),text=page.toStructuredText('preserve-ligatures,preserve-whitespace');
      const blocks:typeof pages[number]['blocks']=[];let lines:typeof blocks[number]['lines']=[],spans:typeof lines[number]['spans']=[];
      try{text.walk({beginTextBlock(){lines=[];blocks.push({type:0,lines});},beginLine(){spans=[];lines.push({spans});},onChar(c,_origin,font,size){const name=font.getName(),last=spans.at(-1);if(last&&last.font===name&&last.size===size)last.text+=c;else spans.push({text:c,size,font:name});}});pages.push({blocks});}finally{text.destroy();page.destroy();}
    }}finally{doc.destroy();}
    return JSON.stringify(pages);
  };
  py.FS.writeFile('/lib/python3.13/site-packages/archivebox_requests.py',requestsAdapter);
  py.registerJsModule('archivebox_papers_io',{request,log,mupdf_spans});
  py.FS.writeFile(site+'/archivebox_papers_network.py',network);
  for(const [path,source]of Object.entries(sources)){
    const target='/papers-upstream/'+path.split('/upstream/src/')[1];py.FS.mkdirTree(target.slice(0,target.lastIndexOf('/')));py.FS.writeFile(target,source);
  }
  py.runPython("import sys; sys.path.insert(0, '/papers-upstream')");
  await py.runPythonAsync(adapt);
  await py.runPythonAsync(run);
  return {
    async acquire(identifier:string,providers:string,userAgent=''){py.globals.set('identifier',identifier);py.globals.set('providers',providers);py.globals.set('user_agent',userAgent);return JSON.parse(await py.runPythonAsync('await acquire(identifier, providers, user_agent)')) as {found:boolean;url?:string;filename?:string;size?:number};},
    async describe(bytes:Uint8Array){py.globals.set('pdf_bytes',bytes);return JSON.parse(await py.runPythonAsync('describe(bytes(pdf_bytes.to_py()))')) as {filename:string;inference:Record<string,unknown>|null};},
    async parse(text:string,match:string[]|null=null,format='jsonl'){py.globals.set('input_text',text);py.globals.set('input_match',match);py.globals.set('input_format',format);return (await py.runPythonAsync('parse(input_text, input_match.to_py() if input_match else None, input_format)')) as string;},
  };
}
