import type {CanonicalPresentation} from '../archive/views';
import fullTemplate from '../../vendor/archivebox/plugins/parse_rss_urls/full.html?raw';

/** Activity has no upstream full template. Use the canonical URL viewer's
 * document, panels, badges and rows with the original hook's activity fields. */
export function behaviorPresentation(data:Record<string,unknown>|null):CanonicalPresentation {
  const plugin='browsertrix_behaviors',title='Browser Behaviors';
  return {type:'canonical',plugin,title,template:fullTemplate.replaceAll('Discovered URLs',title),data,filename:`${plugin}.json`,initialize(document,data,options){
    const el=(tag:string,text?:unknown,cls?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node};
    const content=document.getElementById('content')!;
    if(!data){content.append(el('div','No activity recorded','panel empty'));return}
    const stats=el('section',undefined,'panel stats');
    stats.append(el('span',`${data.steps} steps`,'badge'));
    stats.append(el('span',data.behavior,'badge'));
    for(const behavior of data.behaviors||[])stats.append(el('span',behavior,'badge'));
    if(data.stopped)stats.append(el('span','Stopped','badge'));
    if(data.cancelled)stats.append(el('span','Stopped','badge'));
    content.append(stats);
    {
      const panel=el('section',undefined,'panel'),search=document.createElement('input'),rows=el('div',undefined,'rows');
      search.type='search';search.className='filter';search.placeholder='Filter activity…';search.setAttribute('aria-label','Filter activity');panel.append(search,rows);content.append(panel);
      const logs:unknown[]=Array.isArray(data.logs)?data.logs:[];
      const render=()=>{rows.replaceChildren();(options.preview?logs.slice(0,6):logs).forEach((log,index)=>{
        const text=typeof log==='string'?log:JSON.stringify(log,null,2);if(!text.toLowerCase().includes(search.value.toLowerCase()))return;
        const row=el('article',undefined,'row'),message=el('div',text);message.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';row.append(el('div',index+1,'number'),message);rows.append(row);
      });if(!rows.children.length)rows.append(el('div',logs.length?'No matching activity':'No activity messages','empty'))};search.addEventListener('input',render);render();
    }
  }};
}
