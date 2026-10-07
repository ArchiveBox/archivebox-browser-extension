import type {HookContext,RecordRef} from '@/src/capture/types';
import {FORMATS,parseDocumentUrl,exportUrl,discoverSheets,validateExport,type Sheet} from './utils';

export type GoogleExports = {
  title:string;document_type:string;document_id:string;sheets?:Sheet[];selected_sheet?:string;
  exports:{format:string;path:string;ref:RecordRef;sheet_id?:string;sheet_name?:string}[];
  errors:{format:string;error:string;sheet_id?:string;sheet_name?:string}[];
};

/** The canonical export plan and validation, with response references replacing files. */
export default async function(ctx:HookContext){
  if(ctx.config.GOOGLEDOCS_ENABLED===false)return {status:'skipped' as const,summary:'GOOGLEDOCS_ENABLED=False'};
  const source=new URL(ctx.url),originalDoc=parseDocumentUrl(ctx.url);
  const driveLink=source.protocol==='https:'&&source.host==='drive.google.com'&&(/^\/file\/d\/[\w-]+/.test(source.pathname)||source.pathname==='/open');
  if(!originalDoc&&!driveLink)return {status:'noresults' as const,summary:'Not a supported Google document URL'};
  const page=await ctx.page.evaluate<{url:string;title:string}>('({url:location.href,title:document.title})');
  const currentDoc=parseDocumentUrl(page.url);
  if(originalDoc&&currentDoc&&(originalDoc.id!==currentDoc.id||originalDoc.kind!==currentDoc.kind))throw Error('Chrome tab navigated to a different Google document');
  const doc=currentDoc||originalDoc;
  if(!doc)return {status:'noresults' as const,summary:'Drive URL did not resolve to Docs, Sheets, Slides or Drawings'};
  for(const key of ['resourcekey','authuser','gid'] as const)doc[key]=originalDoc?.[key]||source.searchParams.get(key)||doc[key];
  const value=ctx.config.GOOGLEDOCS_FORMATS??['docx','xlsx','pptx','csv','pdf','svg'];
  const configured=typeof value==='string'?(value.trim().startsWith('[')?JSON.parse(value):value.split(',').map(format=>format.trim()).filter(Boolean)):value;
  if(!Array.isArray(configured)||configured.some(value=>typeof value!=='string'))throw Error('GOOGLEDOCS_FORMATS must be an array of format names');
  const requested=[...new Set(configured as string[])],unknown=requested.filter(format=>!Object.values(FORMATS).flat().includes(format));
  if(unknown.length)throw Error(`Unknown GOOGLEDOCS_FORMATS: ${unknown.join(', ')}`);
  const formats=requested.filter(format=>FORMATS[doc.kind].includes(format));
  if(!formats.length)return {status:'skipped' as const,summary:'GOOGLEDOCS_FORMATS has no formats for this document type'};
  const seconds=Number(ctx.config.GOOGLEDOCS_TIMEOUT??120);
  if(!Number.isFinite(seconds)||seconds<5)throw Error('GOOGLEDOCS_TIMEOUT must be at least 5 seconds');
  const deadline=Date.now()+seconds*1000;
  const data:GoogleExports={title:page.title,document_type:doc.kind,document_id:doc.id,exports:[],errors:[]};
  let sheets:Sheet[]=[],sheetError:string|undefined;
  if(doc.kind==='spreadsheets'&&formats.some(format=>['csv','tsv'].includes(format))){
    try{
      sheets=await discoverSheets({evaluate:fn=>ctx.page.evaluate(`(${fn.toString()})()`)});
      if(doc.gid&&!sheets.some(sheet=>sheet.id===doc.gid))throw Error(`Selected sheet ${doc.gid} is not in this workbook`);
      data.sheets=sheets;data.selected_sheet=doc.gid||sheets[0]!.id;
    }catch(error){sheetError=String(error)}
  }
  const plan=formats.flatMap((format):{format:string;sheet?:Sheet}[]=>{
    if(!['csv','tsv'].includes(format))return [{format}];
    if(sheetError){data.errors.push({format,error:sheetError});return []}
    return sheets.map(sheet=>({format,sheet}));
  });
  const records:RecordRef[]=[];
  for(const {format,sheet} of plan){
    const sheetData=sheet?{sheet_id:sheet.id,sheet_name:sheet.name}:{};
    try{
      ctx.signal.throwIfAborted();
      const timeoutMs=deadline-Date.now();if(timeoutMs<=0)throw Error('Google document export timeout exceeded');
      const ref=await ctx.archive.fetch(exportUrl(sheet?{...doc,gid:sheet.id}:doc,format),{browserSession:true,timeoutMs});
      records.push(ref);
      const response=await ctx.archive.read(ref);
      if(response.status<200||response.status>=300)throw Error(`Browser resource download failed (HTTP ${response.status})`);
      validateExport(response.body,format,response.mime);
      data.exports.push({format,path:sheet?`sheet-${sheet.id}.${format}`:`document.${format}`,ref,...sheetData});
      ctx.log(`${format.toUpperCase()}: ${response.body.length} bytes${sheet?` (${sheet.name})`:''}`);
    }catch(error){data.errors.push({format,...sheetData,error:String(error)})}
  }
  return {status:data.errors.length?'failed' as const:'succeeded' as const,summary:`${data.exports.length}/${data.exports.length+data.errors.length} Google document exports`,records,data};
}
