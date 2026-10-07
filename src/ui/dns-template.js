/** Compiled source port of vendor/archivebox/plugins/dns/full.html.
 * Only the input-file read and output links move to the WACZ host. */
export function initializeDNS(document,records) {
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node};
  const safeLink=(value,label)=>{const a=el('a',label||value);try{const u=new URL(value);if(['https:','http:'].includes(u.protocol)){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
  const parseJsonl=text=>text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});const content=document.getElementById('content');
  const copyLine=value=>{const row=el('div',null,'copyline'),code=el('code',value),button=el('button','Copy','copy');button.type='button';button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(value));button.textContent='Copied'}catch{button.remove()}});row.append(code,button);return row};
  {
    const groups=new Map();records.forEach(record=>{const key=record.hostname||'Unknown host';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record)});
    const answerCount=records.filter(r=>r.ip).length;
    groups.forEach((items,hostname)=>{
      const panel=el('section',null,'panel'),head=el('div',null,'host-head');head.append(el('span','◉'),el('h2',hostname),el('span',items.length+' record'+(items.length===1?'':'s'),'badge'));panel.append(head);
      const map=el('div',null,'map'),requests=el('div',null,'column'),answers=el('div',null,'column'),resolvers=el('div',null,'column');requests.append(el('h3','REQUESTS'));answers.append(el('h3','ANSWERS'));resolvers.append(el('h3','CONFIGURED RESOLVERS'));
      const requestKeys=new Set();items.forEach(item=>{const key=String(item.requestId||'')+'|'+String(item.url||'');if(requestKeys.has(key)||(!item.url&&!item.requestId))return;requestKeys.add(key);const node=el('div',null,'node request');node.append(safeLink(item.url,item.url||'Browser request'));const meta=el('div',null,'meta');if(item.requestId)meta.append(el('span','id '+item.requestId));if(item.protocol)meta.append(el('span',item.protocol.toUpperCase()));node.append(meta);requests.append(node)});if(requests.children.length===1){const node=el('div',null,'node request');node.append(el('strong','Observed hostname'),el('span','No request URL recorded','muted'));requests.append(node)}
      items.forEach(item=>{const node=el('div',null,'node answer'+(item.type==='NXDOMAIN'?' error':''));const line=el('div');line.append(el('span',(item.type==='NXDOMAIN'?'✕ ':'● ')+(item.type||'DNS'),'badge'));node.append(line,item.ip?copyLine(item.ip):el('strong','Name not resolved'));const meta=el('div',null,'meta');if(item.port)meta.append(el('span','port '+item.port));if(item.source)meta.append(el('span','via '+item.source));if(item.ts){const date=new Date(item.ts);meta.append(el('span',Number.isNaN(date.valueOf())?item.ts:date.toLocaleString()))}node.append(meta);if(item.error)node.append(el('div',item.error,'resolver-note'));answers.append(node)});
      const nameservers=[...new Set(items.flatMap(item=>Array.isArray(item.nameservers)?item.nameservers:[]))];nameservers.forEach(ns=>{const node=el('div',null,'node resolver');node.append(copyLine(ns));resolvers.append(node)});if(!nameservers.length){const node=el('div',null,'node resolver');node.append(el('span','Not recorded','muted'));resolvers.append(node)}resolvers.append(el('div','Resolver configuration was captured with each answer; it does not identify which resolver replied.','resolver-note'));
      map.append(requests,el('div','→','arrow'),answers,el('div','⇢','arrow'),resolvers);panel.append(map);content.append(panel);
    });
  }
}
