import * as git from 'isomorphic-git';
import {GitConfigManager} from 'isomorphic-git/managers';
import {FileSystem} from 'isomorphic-git/models';
import {memfs} from 'memfs';
import {Buffer} from 'buffer';
import type {ExtractorRequest} from '../python/transport';
// Required by upstream's documented bundler setup, including worker runtimes.
// https://isomorphic-git.org/docs/en/quickstart-with-bundlers
const runtimeGlobals=globalThis as typeof globalThis & {Buffer?:typeof Buffer};
runtimeGlobals.Buffer ??= Buffer;
export const gitDomains='github.com,gitlab.com,bitbucket.org,gist.github.com,codeberg.org,gitea.com,git.sr.ht';
export function normalizeGitURL(value:string,domains=gitDomains):string|null{
  if(/^(git:\/\/|ssh:\/\/git@|git@)/i.test(value)||value.toLowerCase().includes('.git'))return value;
  let url:URL;try{url=new URL(value)}catch{return null}
  if(!['http:','https:'].includes(url.protocol)||!domains.split(',').map(domain=>domain.trim().toLowerCase()).includes(url.host.toLowerCase().replace(/^www\./,'')))return null;
  const parts=url.pathname.split('/').filter(Boolean);if(parts.length<2)return null;
  return url.origin+'/'+parts.slice(0,2).join('/');
}
export type GitFile={path:string;oid:string;mode:string;size:number};
export type GitSubmodule={path:string;url:string;oid:string;head:string};
export type GitRepository={url:string;head:string;files:GitFile[];submodules:GitSubmodule[];read:(path:string)=>Promise<Uint8Array>;readSync:(path:string)=>Uint8Array;listAll:()=>Promise<string[]>};

/** Upstream Git owns the protocol, pack/index/tree parsing and checkout. Only
 * its documented fs/http interfaces point at memory and captured exchanges. */
export async function cloneGit(url:string,request:ExtractorRequest,options:{signal?:AbortSignal;log?:(message:string)=>void}={}):Promise<GitRepository>{
  if(!/^https?:\/\//.test(url))throw Error('Browser Git transport requires an HTTP or HTTPS repository URL');
  const {fs}=memfs();const files:GitFile[]=[],submodules:GitSubmodule[]=[];
  const checked=()=>options.signal?.throwIfAborted();
  const http:git.HttpClient={request:async args=>{
    checked();const chunks:Uint8Array[]=[];if(args.body)for await(const chunk of args.body)chunks.push(chunk);
    const body=chunks.length?new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0)):null;let offset=0;for(const chunk of chunks){body!.set(chunk,offset);offset+=chunk.length}
    const result=await request(args.url,(args.method||'GET') as 'GET'|'POST',args.headers||{},body,120);checked();
    return {url:result.url,method:args.method||'GET',statusCode:result.status,statusMessage:String(result.status),headers:result.headers,body:(async function*(){yield result.body})()};
  }};
  const clone=async(remote:string,dir:string,prefix:string,oid?:string,ancestors:string[]=[]):Promise<string>=>{
    checked();const identity=remote+'@'+(oid||'HEAD');if(ancestors.includes(identity))throw Error('Recursive submodule cycle: '+identity);
    options.log?.(`Cloning ${remote}${oid?' at '+oid:''}`);
    await git.clone({fs,http,dir,url:remote,depth:1,singleBranch:false,noCheckout:true,onMessage:options.log});
    if(oid){try{await git.readCommit({fs,dir,oid})}catch{await git.fetch({fs,http,dir,url:remote,ref:oid,depth:1,singleBranch:true})}}
    const head=oid||await git.resolveRef({fs,dir,ref:'HEAD'});
    await git.checkout({fs,dir,ref:head,force:true});
    const links:{path:string;oid:string}[]=[];
    const walk=async(tree:string,path='')=>{checked();for(const entry of (await git.readTree({fs,dir,oid:tree})).tree){const relative=path+entry.path;if(entry.type==='tree')await walk(entry.oid,relative+'/');else if(entry.type==='commit')links.push({path:relative,oid:entry.oid});else{const blob=await git.readBlob({fs,dir,oid:entry.oid});files.push({path:prefix+relative,oid:entry.oid,mode:entry.mode,size:blob.blob.length})}}};
    await walk((await git.readCommit({fs,dir,oid:head})).commit.tree);
    if(links.length){
      // Parse .gitmodules through upstream Git's own public configuration model.
      const modules=await git.readBlob({fs,dir,oid:head,filepath:'.gitmodules'});
      const scratch=dir+'/.git/archivebox-modules';await fs.promises.mkdir(scratch,{recursive:true});await fs.promises.writeFile(scratch+'/config',modules.blob);
      const config=await GitConfigManager.get({fs:new FileSystem(fs),gitdir:scratch});
      const definitions=new Map<string,string>();for(const name of await config.getSubsections('submodule'))definitions.set(await config.get(`submodule.${name}.path`),await config.get(`submodule.${name}.url`));
      await fs.promises.unlink(scratch+'/config');await fs.promises.rmdir(scratch);
      for(const link of links){checked();const target=definitions.get(link.path);if(!target)throw Error('Submodule URL missing: '+link.path);
        if(link.path.startsWith('/')||link.path.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'))throw Error('Invalid submodule path: '+link.path);
        const absolute=/^\.\.?\//.test(target)?new URL(target,remote.replace(/\/$/,'')+'/').href:target;
        if(!/^https?:\/\//.test(absolute))throw Error('Submodule requires unsupported non-HTTP transport: '+absolute);
        const childHead=await clone(absolute,dir+'/'+link.path,prefix+link.path+'/',link.oid,[...ancestors,identity]);
        if(childHead!==link.oid)throw Error('Submodule HEAD does not match the parent gitlink');
        submodules.push({path:prefix+link.path,url:absolute,oid:link.oid,head:childHead});
      }
    }
    return head;
  };
  const head=await clone(url,'/repo','');files.sort((a,b)=>a.path.localeCompare(b.path));submodules.sort((a,b)=>a.path.localeCompare(b.path));
  const safe=(path:string)=>{if(path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid repository path');return '/repo/'+path};
  return {url,head,files,submodules,read:async path=>new Uint8Array(fs.lstatSync(safe(path)).isSymbolicLink()?new TextEncoder().encode(String(fs.readlinkSync(safe(path)))):fs.readFileSync(safe(path)) as Uint8Array),readSync:path=>new Uint8Array(fs.lstatSync(safe(path)).isSymbolicLink()?new TextEncoder().encode(String(fs.readlinkSync(safe(path)))):fs.readFileSync(safe(path)) as Uint8Array),listAll:async()=>{
    const result:string[]=[];const list=async(path:string)=>{for(const name of await fs.promises.readdir('/repo'+(path?'/'+path:'')) as string[]){const relative=path?path+'/'+name:name,stat=await fs.promises.lstat('/repo/'+relative);if(stat.isDirectory())await list(relative);else result.push(relative)}};await list('');return result.sort();
  }};
}
