import type { ArchiveEntry, ArchiveReader } from './reader';
import type {GalleryPresentation} from '../../abx-plugins/abx_plugins/plugins/gallerydl/browser/view';
import type {ForumPresentation} from '../../abx-plugins/abx_plugins/plugins/forumdl/browser/view';
import type {GitPresentation} from '../../abx-plugins/abx_plugins/plugins/git/browser/view';
import type {YtdlpPresentation} from '../../abx-plugins/abx_plugins/plugins/ytdlp/browser/view';
import type { Capture } from '../capture/types';
import type {DocumentSource} from '../../abx-plugins/abx_plugins/plugins/liteparse/browser/view';
export type ViewSection =
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { type: 'json'; title: string; data: unknown }
  | { type: 'text'; title: string; text: string }
  | { type: 'html'; title: string; html: string }
  | { type: 'article'; title: string; html: string; plugin: 'readability' | 'defuddle' | 'mercury' }
  | { type: 'stream'; title:string; entry:ArchiveEntry; kind:'hls'|'dash' }
  | { type: 'resource'; title: string; entry: ArchiveEntry };
export type CanonicalOptions={preview?:boolean;downloadURL:string;rawURL:string;openFiles:()=>void;resourceURL:(value:string|null|undefined,base?:string)=>string|undefined};
export type CanonicalPresentation={type:'canonical';plugin:string;title:string;template:string;data:any;initialize:(document:Document,data:any,options:CanonicalOptions)=>void|(()=>void)|Promise<void|(()=>void)>;format?:'json'|'jsonl'|'text';filename?:string;nativePDF?:boolean};
export type ViewResult = { title: string; summary: string; sections: ViewSection[];presentation?:GitPresentation|CanonicalPresentation|GalleryPresentation|ForumPresentation|YtdlpPresentation|{type:'paper';entry?:ArchiveEntry}|{type:'lazy-pdf';landscape:boolean}|{type:'documents';documents:DocumentSource[]}|{type:'responses'} };
export type ViewContext = { archive: ArchiveReader; url: string; capture?: Capture; signal?:AbortSignal; preview?:boolean };
export type ViewModule = { default: (ctx: ViewContext) => Promise<ViewResult> };
const modules = import.meta.glob('../../abx-plugins/abx_plugins/plugins/*/browser/view.ts');
export const views = Object.fromEntries(Object.entries(modules).map(([path, load]) => [path.split('/').at(-3)!, async (context: ViewContext) => (await load() as ViewModule).default(context)]));

type Derivation = {controller:AbortController; promise:Promise<ViewResult>; consumers:number; settled:boolean};
const derivations = new WeakMap<ArchiveReader,Map<string,Derivation>>();
/** Share one derivation between this snapshot's full output and file view. Pending
 * work is cancelled when its last viewer leaves; completed models stay local. */
export function deriveView(name:string,context:ViewContext):Promise<ViewResult> {
  if(name==='media')name='ytdlp';
  if(context.signal?.aborted)return Promise.reject(context.signal.reason);
  let cache=derivations.get(context.archive);
  if(!cache){cache=new Map();derivations.set(context.archive,cache)}
  let job=cache.get(name);
  if(!job){
    const controller=new AbortController();
    job={controller,consumers:0,settled:false,promise:Promise.resolve().then(()=>{
      if(!views[name])throw Error(`Unknown plugin view: ${name}`);
      return views[name]!({...context,signal:controller.signal});
    })};
    const current=job;cache.set(name,current);
    current.promise.then(()=>{current.settled=true},()=>{current.settled=true;if(cache!.get(name)===current)cache!.delete(name)});
  }
  const current=job;current.consumers++;
  return new Promise((resolve,reject)=>{
    let released=false;
    const release=()=>{
      if(released)return;released=true;context.signal?.removeEventListener('abort',abort);
      if(--current.consumers===0&&!current.settled){if(cache!.get(name)===current)cache!.delete(name);current.controller.abort()}
    };
    const abort=()=>{release();reject(context.signal!.reason)};
    context.signal?.addEventListener('abort',abort,{once:true});
    current.promise.then(value=>{if(!released){release();resolve(value)}},error=>{if(!released){release();reject(error)}});
  });
}
