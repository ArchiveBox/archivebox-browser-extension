import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '../../../../../vendor/archivebox/plugins/headers/full.html?raw';
import {initializeHeaders} from '@/src/ui/headers-template';
export default async function({archive,capture,url,signal}:ViewContext):Promise<ViewResult>{
  // The indexed browser navigation is authoritative. history.replaceState and
  // fragment changes can update the visible URL without a new HTTP exchange.
  const entry=archive.documentEntry()||archive.find(capture?.url||url);
  if(!entry)throw Error('Captured page response unavailable');
  signal?.throwIfAborted();const exchange=await archive.exchange(entry);
  const data={url:exchange.url,response_url:exchange.url,status:entry.status,statusText:exchange.statusLine.replace(/^(?:HTTP\/[\d.]+\s+)?\d+\s*/,''),request_headers:exchange.requestHeaders||{},response_headers:exchange.responseHeaders};
  return {title:'HTTP Headers',summary:'',sections:[],presentation:{type:'canonical',plugin:'headers',title:'HTTP Headers',template,data,initialize:initializeHeaders}};
}
