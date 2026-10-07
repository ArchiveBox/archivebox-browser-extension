import {parse,type DefaultTreeAdapterTypes} from 'parse5';
import type {SupportedFileType} from 'officeparser/slim';
const officeMimes:Record<string,string>={
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
 'application/vnd.oasis.opendocument.text':'odt','application/vnd.oasis.opendocument.spreadsheet':'ods',
 'application/vnd.oasis.opendocument.presentation':'odp','application/vnd.oasis.opendocument.graphics':'odg',
 'application/epub+zip':'epub','application/rtf':'rtf','text/rtf':'rtf',
};
export function textFormat(mime:string,name:string){
 const type=mime.split(';')[0]!.trim().toLowerCase(),extension=name.split(/[?#]/)[0]!.split('.').at(-1)?.toLowerCase()||'';
 if(officeMimes[type])return officeMimes[type]!;
 if(/^(docx|xlsx|pptx|odt|ods|odp|odg|rtf|epub)$/.test(extension))return extension;
 if(/(?:json|ndjson|jsonl)/.test(type)||/^(json|jsonl|ndjson)$/.test(extension))return 'json';
 if(/(?:html|xml|rss|atom)/.test(type)||/^(html?|xhtml|xml|rss|atom|ttml|dfxp|svg)$/.test(extension))return 'html';
 if(/^text\//.test(type)&&!/(?:javascript|css)/.test(type)||/^(txt|md|csv|tsv|vtt|srt|ass|ssa|log|tex)$/.test(extension))return 'text';
 return undefined;
}
function htmlText(source:string){
 const parts:string[]=[];let title='';
 function visit(node:DefaultTreeAdapterTypes.Node){
  if('tagName' in node&&/^(script|style|template|noscript)$/.test(node.tagName))return;
  if(node.nodeName==='#text'&&'value' in node)parts.push(node.value);
  if('childNodes' in node){
   const before=parts.length;for(const child of node.childNodes)visit(child);
   if('tagName' in node){if(node.tagName==='title')title=parts.slice(before).join('');parts.push(' ')}
  }
 }
 visit(parse(source));return {title:title.trim(),text:parts.join('').replace(/\s+/g,' ').trim()};
}
function jsonText(value:unknown):string{
 if(typeof value==='string')return /<[a-z][\s\S]*>/i.test(value)?htmlText(value).text:value;
 if(typeof value==='number'||typeof value==='boolean')return String(value);
 if(Array.isArray(value))return value.map(jsonText).join('\n');
 if(value&&typeof value==='object')return Object.values(value).map(jsonText).join('\n');
 return '';
}
/** Original readable content only; article and forum models remain view-time derivations. */
export async function originalText(body:Uint8Array,mime:string,name:string){
 const format=textFormat(mime,name);if(!format)return {title:'',text:''};
 if(!['text','html','json'].includes(format)){
  const {OfficeParser}=await import('officeparser/slim');
  const ast=await OfficeParser.parseOffice(body,{fileType:format as SupportedFileType,ocr:false,extractAttachments:false});
  return {title:'',text:String((await ast.to('text')).value)};
 }
 const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(mime)?.[1]||'utf-8';
 const source=new TextDecoder(charset).decode(body);
 if(format==='html')return htmlText(source);
 if(format==='json'){
  const json=source.replace(/^\s*\)\]\}'[^\n]*\n/,'');
  try{return {title:'',text:jsonText(JSON.parse(json))}}
  catch{
   // Some APIs label framed streams as JSON. Keep their literal readable
   // content searchable even when it is not a single JSON/JSONL document.
   try{return {title:'',text:json.split(/\r?\n/).filter(line=>line.trim()).map(line=>jsonText(JSON.parse(line))).join('\n')}}
   catch{return {title:'',text:source}}
  }
 }
 return {title:'',text:source};
}
