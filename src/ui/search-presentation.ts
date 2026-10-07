import MiniSearch from 'minisearch';
import {cardDocument,cardHTML} from '../archive/cards';
import type {CanonicalPresentation} from '../archive/views';
import fullTemplate from '../../vendor/archivebox/plugins/parse_rss_urls/full.html?raw';
import {searchOptions,type SearchIndex,type SearchDocument} from '../../abx-plugins/abx_plugins/plugins/search_contents/browser/index';
function searchLayout(document:Document,total:number){
  const el=(tag:string,text?:unknown,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node};
  const content=document.getElementById('content')!,stats=el('section',undefined,'panel stats'),count=el('span',undefined,'badge');count.textContent=`${total} documents`;stats.append(count);content.append(stats);
  const panel=el('section',undefined,'panel'),search=document.createElement('input'),rows=el('div',undefined,'rows'),more=document.createElement('button');search.type='search';search.className='filter';search.placeholder='Search archived text…';search.setAttribute('aria-label','Search archived text');more.textContent='Show more';panel.append(search,rows);content.append(panel);
  return {el,panel,search,rows,more,count};
}
export function searchCard(total:number){
 const doc=cardDocument(fullTemplate);searchLayout(doc,total);return cardHTML(doc);
}
export function searchPresentation(data:SearchIndex,read:(document:SearchDocument)=>Promise<string>):CanonicalPresentation {
 return {type:'canonical',plugin:'search_contents',title:'Search',template:fullTemplate.replaceAll('Discovered URLs','Search'),data,filename:'index.json',async initialize(document,data:SearchIndex,options){
  const index=await MiniSearch.loadJSAsync(data.index,searchOptions);
  const {el,panel,search,rows,more,count}=searchLayout(document,data.documents.length);
  const previews=new WeakMap<Element,()=>Promise<void>>(),observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);void previews.get(entry.target)?.()}},{root:document.documentElement,rootMargin:'200px'});
  let matches:SearchDocument[]=[],position=0,generation=0;
  function append(){
   const needle=search.value.trim().toLocaleLowerCase(),terms=needle.split(/\s+/).filter(Boolean),current=generation;
   for(const entry of matches.slice(position,position+40)){
    const row=el('article',undefined,'row'),body=el('div'),title=el('a',entry.title,'url') as HTMLAnchorElement;
    const archivedURL=options.resourceURL(entry.url);if(archivedURL){title.href=archivedURL.replace(/(\d{14,17})id_\//,'$1mp_/');title.target='_blank';title.rel='noopener'}
    body.append(title,el('div',entry.ref.member?.join(' / ')||entry.url,'muted'));const excerpt=el('p');body.append(excerpt);row.append(el('div',++position,'number'),body);rows.append(row);
    previews.set(row,async()=>{
     try{
      const text=await read(entry);if(current!==generation)return;
      const lower=text.toLocaleLowerCase(),exact=needle?lower.indexOf(needle):-1;
      const hit=exact>=0?needle:terms.find(term=>lower.includes(term))||'',offset=hit?lower.indexOf(hit):0,start=Math.max(0,offset-120);
      if(hit)excerpt.append(document.createTextNode(text.slice(start,offset)),el('mark',text.slice(offset,offset+hit.length)),document.createTextNode(text.slice(offset+hit.length,offset+hit.length+240)));
      else excerpt.textContent=text.slice(0,360);
     }catch(error){if(current===generation)excerpt.textContent=String(error)}
    });observer.observe(row);
   }
   if(position>=matches.length)more.remove();else panel.append(more);
  }
  function render(){
   generation++;observer.disconnect();rows.replaceChildren();position=0;
   const query=search.value.trim();matches=query?index.search(query).map(result=>data.documents[Number(result.id)]!):data.documents;
   count.textContent=query?`${matches.length} matching documents`:`${matches.length} documents`;
   if(!matches.length)rows.append(el('div',query?'No matching documents':'No text documents archived','empty'));
   append();
  }
  search.addEventListener('input',render);more.addEventListener('click',append);render();return()=>{generation++;observer.disconnect()};
 }};
}
