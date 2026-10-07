import type {ArchiveReader} from './reader';
import {replayHTML} from './replay';
import {isExtension,playerURL} from '../replay/client';

const policy="default-src 'self' blob:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
const readyExpression=`(async()=>{if(document.readyState!=='complete')await new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));document.querySelectorAll('img').forEach(image=>image.loading='eager');await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));await document.fonts.ready;return true})()`;
export async function printableHTML(archive:ArchiveReader,url:string,preserveForms=false){
  const source=await archive.dom();
  const html=await replayHTML(archive,'<!doctype html>'+source.documentElement.outerHTML,url,{preserveForms});
  return html.replace(/<head([^>]*)>/i,`<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}
async function loadedTab(tabId:number,signal:AbortSignal){
  await new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);chrome.tabs.onUpdated.removeListener(updated);signal.removeEventListener('abort',aborted)};
    const updated=(id:number,change:{status?:string})=>{if(id===tabId&&change.status==='complete'){cleanup();resolve()}};
    const aborted=()=>{cleanup();reject(signal.reason)};
    const timer=setTimeout(()=>{cleanup();reject(Error('Native render page did not load'))},10000);
    chrome.tabs.onUpdated.addListener(updated);signal.addEventListener('abort',aborted,{once:true});
    void chrome.tabs.get(tabId).then(tab=>{if(tab.status==='complete'){cleanup();resolve()}},error=>{cleanup();reject(error)});
  });signal.throwIfAborted();
}
/** Both native outputs render the same offline document in a disposable tab. */
async function chromeRender<T>(html:string,signal:AbortSignal,method:string,params?:Record<string,unknown>):Promise<T>{
  const tab=await chrome.tabs.create({url:chrome.runtime.getURL('print.html'),active:false});if(tab.id===undefined)throw Error('Could not open native render page');
  const target={tabId:tab.id};let attached=false;
  const abort=()=>{void chrome.tabs.remove(tab.id!).catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
  const network=(source:chrome.debugger.Debuggee,method:string,details?:object)=>{
    if(source.tabId!==tab.id||method!=='Fetch.requestPaused')return;
    const event=details as {requestId:string;request:{url:string}};
    const external=/^https?:$/.test(new URL(event.request.url).protocol);
    void chrome.debugger.sendCommand(target,external?'Fetch.failRequest':'Fetch.continueRequest',external?{requestId:event.requestId,errorReason:'BlockedByClient'}:{requestId:event.requestId}).catch(()=>{});
  };
  try{
    signal.throwIfAborted();await loadedTab(tab.id,signal);await chrome.debugger.attach(target,'1.3');attached=true;
    chrome.debugger.onEvent.addListener(network);
    // Match the actual request scheme. URL-glob blocking also matches the
    // original HTTPS URL embedded inside a local Webrecorder replay path.
    await chrome.debugger.sendCommand(target,'Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    await chrome.debugger.sendCommand(target,'Page.enable');
    const tree=await chrome.debugger.sendCommand(target,'Page.getFrameTree') as {frameTree:{frame:{id:string}}};
    await chrome.debugger.sendCommand(target,'Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
    const ready=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:readyExpression,awaitPromise:true,returnByValue:true}) as {exceptionDetails?:{text:string}};
    if(ready.exceptionDetails)throw Error(ready.exceptionDetails.text);
    signal.throwIfAborted();
    return await chrome.debugger.sendCommand(target,method,params) as T;
  }finally{
    signal.removeEventListener('abort',abort);
    chrome.debugger.onEvent.removeListener(network);
    if(attached)await chrome.debugger.detach(target).catch(()=>{});
    await chrome.tabs.remove(tab.id).catch(()=>{});
  }
}

export async function printPDF(archive:ArchiveReader,url:string,landscape:boolean,signal:AbortSignal){
 if(isExtension){
  const result=await chromeRender<{data:string}>(await printableHTML(archive,url),signal,'Page.printToPDF',{printBackground:true,landscape,preferCSSPageSize:true});
  const bytes=Uint8Array.from(atob(result.data),character=>character.charCodeAt(0));
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Chrome did not return a PDF');
  return bytes;
 }
 if(!archive.sourceUrl)throw Error('Open this WACZ in the extension to generate a PDF.');
 const response=await fetch(playerURL('api/print-pdf'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:archive.sourceUrl,landscape}),signal});
 if(!response.ok)throw Error(await response.text());
 if(!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('Native PDF rendering requires the extension or the local preview server.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('The print engine did not return a PDF');
 return bytes;
}

export type AXNode={nodeId:string;parentId?:string;childIds?:string[];ignored?:boolean;role?:{value?:unknown};name?:{value?:unknown};value?:{value?:unknown};properties?:{name:string;value:{value?:unknown}}[]};
export async function accessibilityTree(archive:ArchiveReader,url:string,signal:AbortSignal):Promise<{nodes:AXNode[]}>{
 if(isExtension)return chromeRender(await printableHTML(archive,url,true),signal,'Accessibility.getFullAXTree');
 if(!archive.sourceUrl)throw Error('Open this WACZ in the extension to derive its accessibility tree.');
 const response=await fetch(playerURL('api/accessibility-tree'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:archive.sourceUrl}),signal});
 if(!response.ok)throw Error(await response.text());
 if(!response.headers.get('content-type')?.startsWith('application/json'))throw Error('Native accessibility rendering requires the extension or the local preview server.');
 const tree=await response.json() as {nodes:AXNode[]};
 if(!Array.isArray(tree.nodes)||!tree.nodes.length)throw Error('Chrome did not return an accessibility tree');
 return tree;
}
