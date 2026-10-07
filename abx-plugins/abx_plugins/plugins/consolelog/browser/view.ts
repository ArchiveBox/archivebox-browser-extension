import type { ViewContext, ViewResult } from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/consolelog/full.html?raw';
import { initializeConsole } from '@/src/ui/console-template';

// CDP evidence -> the canonical console.jsonl row contract.
export default async function({ archive }: ViewContext): Promise<ViewResult> {
  const entry = archive.artifact('consolelog');
  const events = entry ? await archive.json<{method:string;params:any}[]>(entry) : [];
  const value = (arg:any) => arg.value !== undefined ? arg.value : arg.unserializableValue || arg.description || arg.type || '';
  const stack = (trace:any):string => trace ? (trace.callFrames||[]).map((frame:any)=>`    at ${frame.functionName||'(anonymous)'} (${frame.url}:${frame.lineNumber+1}:${frame.columnNumber+1})`).concat(stack(trace.parent)||[]).join('\n') : '';
  const data=events.map(({method,params})=>{
    if(method==='Runtime.consoleAPICalled'){
      const args=(params.args||[]).map(value);
      return {timestamp:params.timestamp,type:params.type,text:args.map((arg:any)=>typeof arg==='string'?arg:JSON.stringify(arg)).join(' '),args,location:params.stackTrace?.callFrames?.[0],stack:stack(params.stackTrace)};
    }
    if(method==='Runtime.exceptionThrown'){
      const error=params.exceptionDetails||{};
      return {timestamp:params.timestamp,type:'pageerror',message:error.exception?.description||error.text||'',location:{url:error.url,lineNumber:error.lineNumber,columnNumber:error.columnNumber},stack:stack(error.stackTrace)};
    }
    const log=params.entry||{};
    return {timestamp:log.timestamp,type:log.level||method,text:log.text||'',location:{url:log.url,lineNumber:log.lineNumber},stack:stack(log.stackTrace)};
  });
  return {title:'Console',summary:'',sections:[],presentation:{type:'canonical',plugin:'consolelog',title:'Console',template,data,initialize:initializeConsole,format:'jsonl',filename:'console.jsonl'}};
}
