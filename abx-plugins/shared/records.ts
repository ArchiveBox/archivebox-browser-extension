/** Portable ArchiveBox records. No browser, filesystem, or Django dependencies. */
export type ResourceRef = {url:string; ts:number; captureId:string; member?:string[]};
/** Mirrors abx_dl.output_files.OutputFile, including its extra metadata fields. */
export type OutputFile = {path:string; extension:string; mimetype:string; size:number; [key:string]:unknown};
export type SnapshotRecord = {
  type:'Snapshot'; id:string; url:string; title:string; depth:number;
  tags?:string[];
  created_at:string; status:'sealed';
  config:Record<string,unknown>; plugin_config?:Record<string,Record<string,unknown>>;
  plugins:string[]; capture_state:'complete'|'failed'; final_url?:string; error?:string;
};
export type ArchiveResultRecord = {
  type:'ArchiveResult'; id:string; snapshot_id:string; plugin:string; hook_name:string;
  status:'succeeded'|'noresults'|'skipped'|'failed'; output_str:string;
  start_ts:string; end_ts:string; output_files:OutputFile[];
  output_json:{
    runtime:'browser'; hook_filename:string; ready_ts?:string; termination?:'killed';
    logs:string[]; records:ResourceRef[]; data?:unknown;
  };
};
export type IndexRecord = SnapshotRecord | ArchiveResultRecord;
export const interchange = {format:'archivebox',version:2,index:'index.jsonl'} as const;

/** Same export policy as archivebox.config.common.redact_sensitive_config. */
export function redactConfig(config:Record<string,unknown>,sensitiveKeys:Iterable<string>=[]):Record<string,unknown> {
  const sensitive=new Set(sensitiveKeys);
  return Object.fromEntries(Object.entries(config).map(([key,value])=>[key,
    value!==null&&value!==''&&(sensitive.has(key)||/TOKEN|SECRET|API_KEY|APIKEY|PASSWORD/i.test(key))?'********':value]));
}

export function jsonl(records:Iterable<unknown>):string {
  return [...records].map(record=>JSON.stringify(record)+'\n').join('');
}
export function parseJSONL<T>(text:string,filename:string):T[] {
  return text.split('\n').flatMap((line,index)=>{
    if(!line.trim())return [];
    try{return [JSON.parse(line) as T]}catch{throw Error(`Invalid JSON in ${filename}:${index+1}`)}
  });
}
export function validatePath(path:string):void {
  if(typeof path!=='string'||!path||/[\\\u0000]/.test(path)||path.includes(':')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid output path');
}
