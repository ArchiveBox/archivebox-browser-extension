import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from './infiniscroll.html?raw';
import {renderScroll,type ScrollEvidence,type ScrollFrame,type ScrollImage} from './presentation';
export default async function({archive,url,signal}:ViewContext):Promise<ViewResult>{
 const entry=archive.artifact('infiniscroll'),data:ScrollEvidence|null=entry?await archive.json(entry):null;
 const images=archive.entries.filter(entry=>entry.url.startsWith('urn:fullPage:'));
 const metadata=await Promise.all(images.map(async entry=>{signal?.throwIfAborted();const headers=await archive.headers(entry);return{entry,metadata:JSON.parse(headers.warcHeaders['WARC-JSON-Metadata']||'{}')}}));
 const frames:ScrollFrame[]=[...(data?.frames||[])].sort((a,b)=>a.timestamp-b.timestamp);
 const screenshotMetadata=metadata.filter(item=>item.metadata.screenshot?.version===1);
 const screenshots:ScrollImage[]=screenshotMetadata.map(item=>{const shot=item.metadata.screenshot;return{url:item.entry.url,x:shot.tile.x-shot.fullPage.x,y:shot.tile.y-shot.fullPage.y,width:shot.tile.width,height:shot.tile.height,fullWidth:shot.fullPage.width,fullHeight:shot.fullPage.height,capturedAt:shot.capturedAt}});
 return {title:'Infinite Scroll',summary:'',sections:[],presentation:{type:'canonical',plugin:'infiniscroll',title:'Infinite Scroll',template,data,filename:'infiniscroll.json',initialize:(document,data,options)=>renderScroll(document,data,frames,screenshots,url,options)}};
}
