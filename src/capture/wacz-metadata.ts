import { Downloader } from '../../vendor/archivewebpage/downloader';
import type { Capture } from './types';
import type {RecordedOutputFile} from '../archive/metadata';
import {v5 as uuidv5} from 'uuid';
import {interchange,jsonl,redactConfig,type IndexRecord,type SnapshotRecord,type ArchiveResultRecord} from '../../abx-plugins/shared/records';
import {plugins} from './registry';
import {digestMessage} from '@webrecorder/wabac/swlib';

export type PluginConfigurations = Record<string, Record<string, unknown>>;

/** IDs are assigned when hooks start. Imported results may omit their IDs. */
export function createIndexRecords(capture:Capture, configurations:PluginConfigurations={}):IndexRecord[] {
  if(capture.state!=='complete'||capture.hooks.some(hook=>hook.status==='running'||hook.ended===undefined))throw Error('Cannot export unfinished ArchiveBox results');
  const config:Record<string,unknown>={},overrides:PluginConfigurations={};
  for(const [plugin,values] of Object.entries(configurations)){
    const {HOOK_TIMEOUT,...shared}=values;Object.assign(config,shared);
    if(HOOK_TIMEOUT!==undefined)overrides[plugin]={HOOK_TIMEOUT};
  }
  const sensitive=Object.values(plugins).flatMap(plugin=>Object.entries(plugin.properties||{}).filter(([,property])=>property['x-sensitive']).map(([key])=>key));
  const redacted=redactConfig(config,sensitive);
  const snapshot:SnapshotRecord={type:'Snapshot',id:capture.id,url:capture.url,title:capture.title,depth:capture.depth??0,tags:capture.tags||[],
    created_at:new Date(capture.created).toISOString(),status:'sealed',config:redacted,
    ...(Object.keys(overrides).length?{plugin_config:overrides}:{}),plugins:[...capture.plugins],capture_state:capture.state,
    ...(capture.finalUrl?{final_url:capture.finalUrl}:{}),...(capture.error?{error:capture.error}:{})};
  return [snapshot,...capture.hooks.map((hook):ArchiveResultRecord=>({
    type:'ArchiveResult',id:hook.id||uuidv5(JSON.stringify([capture.id,hook.plugin,hook.hook,hook.started]),uuidv5.URL),
    snapshot_id:capture.id,plugin:hook.plugin,hook_name:hook.hook.replace(/\.[^.]+$/,''),
    status:hook.status==='killed'?'failed':hook.status as ArchiveResultRecord['status'],output_str:hook.summary||'',
    start_ts:new Date(hook.started).toISOString(),end_ts:new Date(hook.ended!).toISOString(),
    output_files:[],output_json:{runtime:'browser',hook_filename:hook.hook,
      ...(hook.ready!==undefined?{ready_ts:new Date(hook.ready).toISOString()}:{}),
      ...(hook.status==='killed'?{termination:'killed' as const}:{}),logs:[...hook.logs],
      records:(hook.records||[]).map(ref=>({...ref,...(ref.member?{member:[...ref.member]}:{})})),
      ...(hook.data!==undefined?{data:hook.data}:{})},
  }))];
}

/** Route generated evidence into native members through upstream ZIP hashing.
 * HTTP WARC/CDX generation and datapackage-digest.json remain upstream-owned.
 */
export class PluginDownloader extends Downloader {
  private readonly records:IndexRecord[];
  private files:RecordedOutputFile[]=[];
  constructor(options: ConstructorParameters<typeof Downloader>[0], capture: Capture, configurations?: PluginConfigurations) {
    super(options);
    this.records = createIndexRecords(capture, configurations);
  }
  override shouldExportWARCResource(resource:any):boolean {
    return !(resource.url.startsWith('urn:')&&resource.extraOpts?.resource);
  }
  override async addExtraFiles(zip:any[],sizeCallback?:((size:number)=>void)|null) {
    const evidence:any[]=[],http=new Map<string,{url:string;ts:number}>(),available=new Set<string>();
    const digest=async(resource:any)=>resource.digest||await digestMessage(await this.evidenceBytes(resource),'sha-256');
    for await(const resource of this.iterResources(this.firstResources)){
      available.add(JSON.stringify([resource.url,resource.ts]));
      if(!this.shouldExportWARCResource(resource))evidence.push(resource);
      else if(/^https?:/.test(resource.url)){
        const hash=await digest(resource);if(!http.has(hash))http.set(hash,{url:resource.url,ts:resource.ts});
      }
    }
    const snapshotId=this.records[0]!.id;
    for(const record of this.records)if(record.type==='ArchiveResult')for(const ref of record.output_json.records){
      if(ref.captureId!==snapshotId||!available.has(JSON.stringify([ref.url,ref.ts])))throw Error(`Missing hook resource: ${ref.url}`);
    }
    const paths=new Map<string,string>(),used=new Set<string>();
    const results=new Map(this.records.filter((record):record is ArchiveResultRecord=>record.type==='ArchiveResult').map(result=>[result.id,result]));
    const safe=(value:unknown)=>String(value||'evidence').replace(/[^a-zA-Z0-9_-]/g,'-');
    const identity=(resource:any)=>safe(resource.extraOpts?.plugin)+'/'+safe(resource.url.split(':')[1]);
    const counts=new Map<string,number>(),positions=new Map<string,number>();
    for(const resource of evidence)counts.set(identity(resource),(counts.get(identity(resource))||0)+1);
    evidence.sort((a,b)=>a.ts-b.ts||a.url.localeCompare(b.url));
    for(const resource of evidence){
      const hash=await digest(resource),reference=http.get(hash);
      const result=results.get(resource.extraOpts?.archive_result_id);
      if(!result||result.plugin!==resource.extraOpts?.plugin)throw Error(`Missing owning ArchiveResult for ${resource.url}`);
      const plugin=safe(resource.extraOpts?.plugin),kind=safe(resource.url.split(':')[1]),key=identity(resource);
      const index=(positions.get(key)||0)+1;positions.set(key,index);
      const mimetype=resource.mime||'application/octet-stream',mime=mimetype.split(';')[0]!.toLowerCase();
      const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','text/html':'html','application/json':'json','application/x-ndjson':'jsonl','text/plain':'txt','application/pdf':'pdf','application/zip':'zip'} as Record<string,string>)[mime]||'bin';
      let name=plugin==='screenshot'&&kind==='fullPage'?'screenshot':kind;
      if(plugin==='screenshot'&&kind==='fullPage'){name+='-'+String(resource.extraOpts?.screenshot?.tile?.index+1||index).padStart(2,'0');}
      else if((counts.get(key)||0)>1)name+='-'+String(index).padStart(4,'0');
      let path=`${plugin}/${name}.${extension}`,suffix=1;while(used.has(path))path=`${plugin}/${name}-${++suffix}.${extension}`;
      used.add(path);
      const existing=paths.get(hash),metadata={...resource.extraOpts};
      delete metadata.archive_result_id;
      const output:RecordedOutputFile={path:path.slice(plugin.length+1),extension,mimetype,size:0,
        url:resource.url,ts:resource.ts,hash:hash.replace(/^sha-256:/,'sha256:'),
        headers:Object.fromEntries(new Headers(resource.respHeaders||{})),metadata,
        storage:reference?{type:'warc-response',...reference}:{type:'wacz-member',path:existing||path}};
      result.output_files.push(output);this.files.push(output);
      if(reference)output.size=(await this.evidenceBytes(resource)).length;
      else if(!existing){
        paths.set(hash,path);
        this.addFile(zip,path,this.generateEvidence(resource),sizeCallback);
      }
    }
    this.addFile(zip,interchange.index,this.generateIndex(),sizeCallback);
  }
  private async *generateIndex(){
    for(const file of this.files){
      if(file.storage.type==='wacz-member'){
        const path=file.storage.path,stats=this.fileStats.find(stats=>stats.filename===path);
        if(!stats?.hash)throw Error(`Plugin ZIP member was not hashed: ${path}`);
        if(file.hash!==`sha256:${stats.hash}`)throw Error(`Generated payload changed: ${file.url}`);
        file.size=stats.size;
      }
    }
    yield jsonl(this.records);
  }
  private async evidenceBytes(resource:any):Promise<Uint8Array> {
    const payload=await this.db.loadPayload(resource,{});
    if(!payload)throw Error(`Missing original generated evidence: ${resource.url}`);
    return payload instanceof Uint8Array?payload:await payload.readFully();
  }
  private async *generateEvidence(resource:any){yield await this.evidenceBytes(resource);}
  override getDataPackageMetadata(): Record<string, unknown> {
    return {archivebox:interchange};
  }
}
