/** Compiled source port of vendor/archivebox/plugins/headers/full.html.
 * Only the input-file read and output links move to the WACZ host. */
export function initializeHeaders(document,data) {
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node};
  const safeLink=(value,label)=>{const a=el('a',label||value);try{const u=new URL(value);if(['https:','http:'].includes(u.protocol)){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
  const displayValue=value=>typeof value==='string'?value:JSON.stringify(value);const content=document.getElementById('content');
  const message=(kind,title,url,headers,status)=>{const box=el('section',null,'panel message '+kind),head=el('div',null,'message-head');head.append(el('span',kind==='request'?'↗':'↙'),el('h2',title));if(status!=null){const n=Number(status),cls=n>=200&&n<300?'good':n>=300&&n<400?'redirect':n>=400?'bad':'';head.append(el('span',String(status),'badge status '+cls))}box.append(head);if(url)box.append(safeLink(url,url));if(box.lastElementChild&&box.lastElementChild.tagName==='A')box.lastElementChild.className='url';const list=el('div',null,'headers');Object.entries(headers||{}).sort(([a],[b])=>a.localeCompare(b)).forEach(([name,value])=>{const row=el('div',null,'header-row');row.append(el('div',name,'header-name'+(name.startsWith(':')?' pseudo':'')),el('div',displayValue(value),'header-value'));list.append(row)});if(!list.childElementCount)list.append(el('div','No headers recorded','muted'));box.append(list);return box};
  {
    const requestHeaders=data.request_headers||{},responseHeaders=data.response_headers||data.headers||{},status=data.status==null?responseHeaders[':status']:data.status;
    let host='Captured request';try{host=new URL(data.url).host}catch{}
    const responseUrl=data.response_url||data.final_url||data.url;if(data.final_url&&data.final_url!==data.url){const final=el('div',null,'final');final.append(el('span','↪','muted'),el('strong','Final URL'),safeLink(data.final_url,data.final_url));content.append(final)}
    const exchange=el('div',null,'exchange'),flow=el('div',null,'flow');flow.append(el('span','⇄'),el('span','HTTP exchange'));exchange.append(message('request','Request',data.url,requestHeaders),flow,message('response','Response'+(data.statusText?' · '+data.statusText:''),responseUrl,responseHeaders,status));content.append(exchange);
  }
}
