/** Compiled source port of vendor/archivebox/plugins/redirects/full.html.
 * Only the input-file read and output links move to the WACZ host. */
export function initializeRedirects(document,records) {
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node};
  const safeLink=(value,label)=>{const a=el('a',label||value);try{const u=new URL(value);if(['https:','http:'].includes(u.protocol)){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
  const parseJsonl=text=>text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
  const typeLabel=type=>({http:['↳','HTTP'],javascript:['⚡','JavaScript / navigation'],meta_refresh:['⏱','Meta refresh']}[type]||['↪',String(type||'Redirect').replaceAll('_',' ')]);const content=document.getElementById('content');
  const urlNode=(url,label,cls)=>{const node=el('div',null,'node '+(cls||''));node.append(el('span',label,'node-label'));if(url)node.append(safeLink(url,url));else node.append(el('span','Unknown URL','url muted'));return node};
  {
    const initial=records.find(r=>r.type==='initial'),transitions=records.filter(r=>r.type!=='initial'&&r.to_url),start=initial?.to_url||transitions[0]?.from_url,final=transitions.at(-1)?.to_url||start;
    const panel=el('section',null,'panel'),overview=el('div',null,'overview');overview.append(el('strong','🧭 Navigation path'),el('span',transitions.length+' hop'+(transitions.length===1?'':'s'),'badge'));if(transitions.some(r=>r.type==='http'))overview.append(el('span','HTTP','badge'));if(transitions.some(r=>r.type==='javascript'))overview.append(el('span','⚡ Script / navigation','badge'));if(transitions.some(r=>r.type==='meta_refresh'))overview.append(el('span','⏱ Meta','badge'));panel.append(overview);
    const chain=el('div',null,'chain');
    const edgeFor = (record, isInitial = false) => {
      const info = isInitial ? ['↗', 'Initial navigation'] : typeLabel(record.type);
      const edge = el('div', null, 'edge');
      if (isInitial) edge.append(el('span', record.from_url || 'about:blank', 'origin'));
      const cause = el('span', info[0] + ' ' + info[1], 'cause ' + (record.type || ''));
      if (record.status) cause.append(el('span', ' ' + record.status, 'badge'));
      edge.append(cause);
      if (record.content) edge.append(el('span', record.content, 'detail'));
      if (record.timestamp) edge.append(el('time', record.timestamp, 'detail'));
      edge.append(el('span', null, 'edge-line'));
      return edge;
    };
    chain.append(edgeFor(initial || {}, true), urlNode(start, transitions.length ? '1 · Initial page' : '1 · Final page', 'start'));
    transitions.forEach((record, index) => {
      let destination = record.to_url;
      try { destination = new URL(record.to_url, record.from_url || start).href; } catch {}
      chain.append(edgeFor(record), urlNode(destination, (index + 2) + (index === transitions.length - 1 ? ' · Final page' : ' · Redirected page'), index === transitions.length - 1 ? 'end' : ''));
    });
    panel.append(chain);content.append(panel);
  }
}
