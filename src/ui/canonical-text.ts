// @ts-nocheck
// Source port of canonical title, htmltotext and parse_* full.html renderers.
// Only filesystem fetches/actions are supplied by the shared WACZ presenter.
import type {CanonicalPresentation} from '../archive/views';
const templates=import.meta.glob(['../../vendor/archivebox/plugins/title/full.html','../../vendor/archivebox/plugins/htmltotext/full.html','../../vendor/archivebox/plugins/parse_*/full.html'],{eager:true,query:'?raw',import:'default'}) as Record<string,string>;
export function initializeURLs(document:Document,text:string,options?:{preview?:boolean}) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; };
  const safeLink = (value, label) => {
    const a = el('a', label || value, 'url');
    try {
      const u = new URL(String(value));
      if (['https:', 'http:'].includes(u.protocol)) { a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    } catch {}
    return a;
  };
  const valueText = (value) => Array.isArray(value) ? value.join(', ') : value;
  const content = document.getElementById('content');



    const rows = text.split(/\r?\n/).map(line => { try { const value = JSON.parse(line); return value && typeof value === 'object' && typeof value.url === 'string' ? value : null; } catch { return null; } }).filter(Boolean);

    const stats = el('section', null, 'panel stats');
    stats.append(el('span', '🔗 ' + rows.length + ' URL' + (rows.length === 1 ? '' : 's'), 'badge'));
    const depths = [...new Set(rows.map(row => row.depth).filter(value => value != null))];
    if (depths.length) stats.append(el('span', '↳ depth ' + depths.join(', '), 'badge'));
    const plugins = [...new Set(rows.map(row => row.plugin).filter(Boolean))];
    if (plugins.length) stats.append(el('span', '⚙ ' + plugins.join(', '), 'badge'));
    content.append(stats);

    const panel = el('section', null, 'panel');
    const filter = el('input'); filter.className = 'filter'; filter.type = 'search'; filter.placeholder = 'Filter URLs, titles, or tags…'; filter.setAttribute('aria-label', 'Filter discovered URLs');
    const list = el('div', null, 'rows'); panel.append(filter, list); content.append(panel);
    const render = () => {
      const needle = filter.value.trim().toLowerCase();
      list.replaceChildren();
      let shown = 0;
      (options?.preview?rows.slice(0,12):rows).forEach((row, index) => {
        const searchable = JSON.stringify(row).toLowerCase();
        if (needle && !searchable.includes(needle)) return;
        const article = el('article', null, 'row');
        article.append(el('div', String(index + 1).padStart(2, '0'), 'number'));
        const body = el('div');
        const label = row.title || row.name || row.description;
        if (label) body.append(el('div', label, 'title'));
        body.append(safeLink(row.url, row.url));
        const meta = el('div', null, 'meta');
        [['tags','🏷 '],['bookmarked_at','🕒 '],['timestamp','🕒 '],['depth','↳ depth '],['plugin','⚙ '],['type','◌ '],['source','◌ '],['source_url','◌ ']].forEach(([key, icon]) => {
          if (row[key] == null || row[key] === '') return;
          meta.append(el('span', icon + valueText(row[key]), 'badge'));
        });
        if (meta.childElementCount) body.append(meta);
        article.append(body); list.append(article); shown += 1;
      });
      if (!shown) list.append(el('div', 'No matching URLs', 'empty'));
    };
    filter.addEventListener('input', render); render();

}
export function textPresentation(plugin:string,data:string,kind:'title'|'text'|'urls'):CanonicalPresentation {
 const template=templates['../../vendor/archivebox/plugins/'+plugin+'/full.html'];
 if(!template)throw Error('Canonical plugin template missing: '+plugin);
 return {type:'canonical',plugin,title:kind==='urls'?'Discovered URLs':kind==='title'?'Title':'HTML to Text',template,data,format:'text',filename:kind==='urls'?'urls.jsonl':kind==='title'?'title.txt':'htmltotext.txt',initialize:kind==='urls'?initializeURLs:kind==='title'?(document,data)=>{const title=document.createElement('h1');title.className='page-title';title.textContent=data;document.getElementById('content')!.append(title)}:(document,data)=>{document.getElementById('article')!.textContent=data.trim()}};
}
