import type {ViewContext} from '@/src/archive/views';
import {cardDocument,cardHTML} from '@/src/archive/cards';
import {initializeConsole} from '@/src/ui/console-template';
import template from '@/vendor/archivebox/plugins/consolelog/full.html?raw';
export default async function(context:ViewContext){
 const {archive}=context;
 const entry=archive.artifact('consolelog'),events=entry?await archive.json<any[]>(entry):[];
 const rows=events.slice(0,6).map(({method,params})=>({
  type:method==='Runtime.exceptionThrown'?'pageerror':params.type||params.entry?.level||method,
  timestamp:params.timestamp||params.entry?.timestamp,
  text:((params.args||[]).map((arg:any)=>arg.value??arg.unserializableValue??arg.description??arg.type).join(' ')||params.entry?.text||params.exceptionDetails?.exception?.description||params.exceptionDetails?.text||'').slice(0,600),
 }));
 const doc=cardDocument(template);initializeConsole(doc,rows);
 doc.querySelector('.toolbar')?.remove();
 const stats=doc.querySelector('.stats');if(stats)stats.textContent=`${events.length} messages`;
 return cardHTML(doc);
}
