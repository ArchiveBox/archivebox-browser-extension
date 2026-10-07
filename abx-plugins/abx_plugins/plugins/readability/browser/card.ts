import type {ViewContext} from '@/src/archive/views';
import {cardDOM,cardDocument,cardHTML,cardElement} from '@/src/archive/cards';
import template from '@/vendor/archivebox/plugins/htmltotext/full.html?raw';
export default async function({archive,capture}:ViewContext){
 const source=await cardDOM(archive),doc=cardDocument(template),article=doc.getElementById('article')!;
 article.replaceChildren();article.append(cardElement(doc,'h1',capture?.title||source.title));
 const root=source.querySelector('article,main,[role="main"]')||source.body;
 let length=0;
 for(const node of root.querySelectorAll('p,blockquote')){const text=node.textContent?.trim();if(!text||node.closest('nav,header,footer,script,style'))continue;article.append(cardElement(doc,'p',text.slice(0,1800-length)));length+=text.length;if(length>=1800)break}
 if(!length){const text=source.querySelector('meta[name="description"],meta[property="og:description"]')?.getAttribute('content');if(text)article.append(cardElement(doc,'p',text))}
 return cardHTML(doc);
}
