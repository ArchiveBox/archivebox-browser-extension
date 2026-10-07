import type {ViewContext} from '@/src/archive/views';
import {sourceEntries} from '../../parse_txt_urls/browser/urls';
export async function bookmarkSources({archive,url}:ViewContext){
 const sources=[];
 for(const entry of sourceEntries(archive,url,mime=>/(?:html|^text\/plain)/i.test(mime))){
  const source=await archive.text(entry),signature=source.slice(0,200000);
  if(/netscape-bookmark-file-1/i.test(signature)||(/<dt\b/i.test(signature)&&/<a\b[^>]*href/i.test(signature))||(/<dl\b/i.test(signature)&&/add_date\s*=/i.test(signature)))sources.push({entry,source});
 }
 return sources;
}
