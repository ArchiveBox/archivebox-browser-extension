import {interchange,parseJSONL,validatePath,type OutputFile,type ArchiveResultRecord,type IndexRecord,type ResourceRef} from '../../abx-plugins/shared/records';
import type {Capture,HookStatus} from '../capture/types';

export type PluginFile = {
  url:string;ts:number;mime:string;status:number;headers:Record<string,string>;
  metadata:Record<string,unknown>;hash:string;bytes:number;
} & ({path:string;record?:never}|{path?:never;record:{url:string;ts:number}});

/** Recorder metadata carried by the existing ArchiveResult.output_files entries. */
export type RecordedOutputFile = OutputFile & {
  url:string;ts:number;hash:string;headers:Record<string,string>;metadata:Record<string,unknown>;
  storage:{type:'wacz-member';path:string}|{type:'warc-response';url:string;ts:number};
};

/** Runtime projection for existing plugin views; never serialized into WACZ. */
export type CaptureMetadata = {
  captureId:string; state:Capture['state']; created:number; url:string; finalUrl?:string;
  title:string; error?:string; tags?:string; files:PluginFile[];
  plugins:{id:string;config:Record<string,unknown>|null;hooks:{
    id?:string;name:string;status:HookStatus;started:number;ended?:number;ready?:number;
    summary?:string;logs:string[];records:ResourceRef[];data?:unknown;
  }[]}[];
};

function outputFile(file:RecordedOutputFile):PluginFile {
  validatePath(file.path);
  if(!file.url?.startsWith('urn:')||!Number.isSafeInteger(file.ts)||!Number.isSafeInteger(file.size)||file.size<0||
    !/^sha256:[0-9a-f]{64}$/.test(file.hash))throw Error('Invalid recorded output file');
  const base={url:file.url,ts:file.ts,mime:file.mimetype,status:200,
    headers:file.headers,metadata:file.metadata,hash:file.hash,bytes:file.size};
  if(file.storage?.type==='wacz-member'){
    validatePath(file.storage.path);return {...base,path:file.storage.path};
  }
  if(file.storage?.type==='warc-response'&&/^https?:\/\//.test(file.storage.url)&&Number.isSafeInteger(file.storage.ts)){
    return {...base,record:{url:file.storage.url,ts:file.storage.ts}};
  }
  throw Error('Invalid recorded output location');
}

export async function readCaptureMetadata(manifest:any,read:(path:string)=>Promise<Uint8Array>):Promise<CaptureMetadata|undefined> {
  const descriptor=manifest.archivebox;
  if(!descriptor)return undefined;
  // Existing immutable experimental captures predate the interchange records.
  // One read boundary keeps those captures usable; all writes use JSONL only.
  if(descriptor.format==='archivebox-plugins'&&descriptor.version===1)return {...descriptor,files:descriptor.files||[]};
  if(descriptor.format!==interchange.format||descriptor.version!==interchange.version||
    descriptor.index!==interchange.index)throw Error('Unsupported ArchiveBox interchange version');
  const decoder=new TextDecoder();
  const indexBytes=await read(interchange.index);
  const records=parseJSONL<IndexRecord>(decoder.decode(indexBytes),interchange.index);
  const snapshots=records.filter(record=>record.type==='Snapshot');
  if(snapshots.length!==1)throw Error('Expected one Snapshot in capture index.jsonl');
  const snapshot=snapshots[0]!;
  const results=records.filter((record):record is ArchiveResultRecord=>record.type==='ArchiveResult');
  const identities=new Set<string>();
  for(const record of records){
    if(!record.id||identities.has(record.id))throw Error('Duplicate or missing ArchiveBox record ID');
    identities.add(record.id);
  }
  for(const result of results){
    if(result.snapshot_id!==snapshot.id||!['succeeded','failed','skipped','noresults'].includes(result.status)||
      !Number.isFinite(Date.parse(result.start_ts))||!Number.isFinite(Date.parse(result.end_ts)))throw Error('Invalid ArchiveResult metadata');
    for(const ref of result.output_json.records){
      if(ref.captureId!==snapshot.id||!Number.isSafeInteger(ref.ts))throw Error('ArchiveResult references a different capture');
    }
  }
  return {captureId:snapshot.id,state:snapshot.capture_state,created:Date.parse(snapshot.created_at),url:snapshot.url,
    finalUrl:snapshot.final_url,title:snapshot.title,error:snapshot.error,
    files:results.flatMap(result=>result.output_files.map(file=>outputFile(file as RecordedOutputFile))),
    plugins:snapshot.plugins.map(id=>({id,config:{...snapshot.config,...snapshot.plugin_config?.[id]},hooks:results.filter(result=>result.plugin===id).map(result=>({
      id:result.id,name:result.output_json.hook_filename,status:result.output_json.termination||result.status,
      started:Date.parse(result.start_ts),ended:Date.parse(result.end_ts),
      ...(result.output_json.ready_ts?{ready:Date.parse(result.output_json.ready_ts)}:{}),
      summary:result.output_str,logs:result.output_json.logs,records:result.output_json.records,data:result.output_json.data,
    }))})),
  };
}
