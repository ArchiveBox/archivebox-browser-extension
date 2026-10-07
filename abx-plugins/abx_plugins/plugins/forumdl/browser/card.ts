import type {ViewContext} from '@/src/archive/views';
import {cardDOM,cardDocument,cardHTML,cardElement,hookSummary} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/forumdl/full.html?raw';
export default async function(context:ViewContext){
 const source=await cardDOM(context.archive),doc=cardDocument(template),content=doc.getElementById('content')!;
 const header=cardElement(doc,'section','','thread-head');
 header.append(cardElement(doc,'h2',context.capture?.title||source.title,'thread-title'));
 const counts=hookSummary(context,'forumdl').match(/\d+ (?:boards|threads|posts|files)/g)||[];
 header.append(cardElement(doc,'div',counts.join(' · '),'thread-meta'));content.replaceChildren(header);
 const comments=source.querySelectorAll('.comment, .cooked, .postbody, .message-body, blockquote');
 for(const comment of [...comments].slice(0,3)){const item=cardElement(doc,'article','','comment');item.append(cardElement(doc,'div',comment.textContent?.trim().slice(0,1000),'comment-body rich'));content.append(item)}
 return cardHTML(doc);
}
