import type {ViewContext} from '@/src/archive/views';
import {cardHTML,cardDOM} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/git/card.html?raw';
import {initializeGitCard} from '@/src/ui/git-template';
export default async function({archive,url}:ViewContext){
 const html=template.slice(template.indexOf('<!doctype html>'),template.indexOf('{% endfilter %}')).replace(/<script[^>]*>[\s\S]*?<\/script>/,'');
 const doc=new DOMParser().parseFromString(html,'text/html');
 const files=(archive.metadata?.files||[]).filter((file:any)=>file.path?.startsWith('git/')).map((file:any)=>({...file,plugin:'git',path:file.path.slice(4)}));
 await initializeGitCard(doc,files,{source:url,page:(await cardDOM(archive)).documentElement.outerHTML});
 if(!files.length)doc.getElementById('count')?.setAttribute('hidden','');
 return cardHTML(doc);
}
