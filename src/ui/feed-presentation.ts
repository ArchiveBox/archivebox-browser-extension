import type {CanonicalPresentation} from '../archive/views';
import type {Feed} from '../../abx-plugins/abx_plugins/plugins/rss/browser/feed';
import fullTemplate from '../../vendor/archivebox/plugins/parse_rss_urls/full.html?raw';
export type ArchivedFeed={url:string;feed?:Feed;error?:string};
/** Feed entries reuse the canonical URL viewer's panels and article rows. */
export function feedPresentation(data:ArchivedFeed[]):CanonicalPresentation {
  return {type:'canonical',plugin:'rss',title:'Feeds',template:fullTemplate.replaceAll('Discovered URLs','Feeds'),data,filename:'feeds.json',initialize(document,data:ArchivedFeed[],options){
    const el=(tag:string,text?:unknown,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node};
    const content=document.getElementById('content')!,stats=el('section',undefined,'panel stats');
    stats.append(el('span',`${data.filter(item=>item.feed).length} feeds`,'badge'),el('span',`${data.reduce((total,item)=>total+(item.feed?.items.length||0),0)} entries`,'badge'));content.append(stats);
    if(!data.length){content.append(el('div','No feeds archived','panel empty'));return}
    const search=document.createElement('input');search.type='search';search.className='filter';search.placeholder='Filter entries…';search.setAttribute('aria-label','Filter feed entries');content.append(search);
    const entries:{node:HTMLElement;search:string}[]=[];
    for(const item of options.preview?data.slice(0,2):data){
      const panel=el('section',undefined,'panel'),heading=el('h2',item.feed?.title||item.url);heading.style.cssText='font-size:18px;margin:0 0 8px';panel.append(heading);
      const original=el('a',item.url,'url') as HTMLAnchorElement;const originalURL=options.resourceURL(item.url);if(originalURL){original.href=originalURL;original.target='_blank';original.rel='noopener'}panel.append(original);
      if(item.error)panel.append(el('p',item.error,'muted'));
      if(item.feed?.description)panel.append(el('p',item.feed.description.replace(/<[^>]*>/g,''),'muted'));
      const rows=el('div',undefined,'rows');panel.append(rows);content.append(panel);
      (options.preview?item.feed?.items.slice(0,6):item.feed?.items)?.forEach((entry,index)=>{
        const row=el('article',undefined,'row'),body=el('div'),title=el('a',entry.title||entry.url,'url') as HTMLAnchorElement;
        const archivedURL=options.resourceURL(entry.url);if(archivedURL){title.href=archivedURL.replace(/(\d{14})id_\//,'$1mp_/');title.target='_blank';title.rel='noopener'}
        body.append(title);const meta=el('div',undefined,'meta');for(const value of [entry.author,entry.date,...entry.tags])if(value)meta.append(el('span',value,'badge'));body.append(meta);
        if(entry.summary)body.append(el('p',entry.summary.replace(/<[^>]*>/g,'')));
        row.append(el('div',index+1,'number'),body);rows.append(row);entries.push({node:row,search:JSON.stringify(entry).toLowerCase()});
      });
    }
    search.addEventListener('input',()=>{for(const entry of entries){const visible=entry.search.includes(search.value.toLowerCase());entry.node.hidden=!visible;entry.node.style.display=visible?'':'none'}});
  }};
}
