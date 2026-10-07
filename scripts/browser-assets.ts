import {createRequire} from 'node:module';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
/** Include copied Python/WASM assets as well as Vite's content-hashed code in
 * the offline derivation cache identity, including locally patched wheels. */
export function pythonRuntimeRevision(){
  const root=fileURLToPath(new URL('../public/',import.meta.url));
  const files=browserAssets().filter(asset=>asset.relativeDest.startsWith('pyodide/')).map(asset=>asset.absoluteSrc);
  for(const folder of ['pyodide','gallery-dl','forum-dl','papers-dl','ytdlp']){
    for(const file of readdirSync(path.join(root,folder),{withFileTypes:true,recursive:true}))if(file.isFile())files.push(path.join(file.parentPath,file.name));
  }
  const hash=createHash('sha256');
  for(const file of files.sort()){hash.update(path.basename(file));hash.update(readFileSync(file))}
  return hash.digest('hex');
}
export function browserAssets(){
  const assets:{absoluteSrc:string;relativeDest:string}[]=[];
  const add=(directory:string,destination:string,accept:((name:string)=>boolean)=()=>true)=>{
    for(const file of readdirSync(directory,{withFileTypes:true,recursive:true}))if(file.isFile()&&accept(file.name)){
      const absoluteSrc=path.join(file.parentPath,file.name);assets.push({absoluteSrc,relativeDest:path.join(destination,path.relative(directory,absoluteSrc))});
    }
  };
  const root=path.dirname(require.resolve('pyodide/package.json'));
  add(root,'pyodide',name=>['pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'].includes(name));
  const paddleRequire=createRequire(path.resolve('node_modules/@paddleocr/paddleocr-js/package.json'));
  add(path.dirname(paddleRequire.resolve('onnxruntime-web')),'ocr/ort',name=>/^ort-wasm-simd-threaded\.jsep\.(mjs|wasm)$/.test(name));
  // Package the real FFmpeg worker/core; replay never loads executable code from a CDN.
  add(path.dirname(require.resolve('@ffmpeg/ffmpeg/worker')),'ytdlp/ffmpeg/worker',name=>name.endsWith('.js'));
  add(path.join(path.dirname(require.resolve('@ffmpeg/core')),'../esm'),'ytdlp/ffmpeg/core',name=>/\.(js|wasm)$/.test(name));
  return assets;
}
