/** Compiled original SSL Certificates full.html script. Original DER-derived
 * PEM strings become transient downloads instead of filesystem pemPath links. */
export function initializeSSLCerts(document:Document,records:any[]){
 const urls:string[]=[];
  const el=<T extends keyof HTMLElementTagNameMap>(tag:T,text?:unknown,cls?:string)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node};
  const safeLink=(value:string,label?:string)=>{const a=el('a',label||value);try{const u=new URL(value);if(['https:','http:'].includes(u.protocol)){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
  const fmtDate=(value:any)=>{const n=Number(value);const date=new Date(Number.isFinite(n)&&n<1e12?n*1000:value);return Number.isNaN(date.valueOf())?String(value||'—'):date.toLocaleString()};
  const roleInfo=(role:string)=>(({leaf:['🔐','Website certificate'],intermediate:['🔗','Intermediate certificate'],root:['⚓','Root certificate']} as Record<string,string[]>)[role]||['📜','Certificate']);const content=document.getElementById('content')!;
  const appendCopy=(parent:HTMLElement,value:unknown)=>{const row=el('span',null,'hash-row'),code=el('code',value),button=el('button','Copy','copy');button.type='button';button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(value));button.textContent='Copied'}catch{button.textContent='Select';const selection=document.getSelection();const range=document.createRange();range.selectNodeContents(code);selection?.removeAllRanges();selection?.addRange(range)}});row.append(code,button);parent.append(row)};
    records.forEach((record:any,recordIndex:number)=>{
      const top=el('div',null,'request');
      const request=el('div');request.append(safeLink(record.url,'🌐 '+(record.url||'Captured request')));request.lastElementChild!.classList.add('request-url');
      const session=el('div',null,'session');session.append(el('strong','🔒 '+(record.protocol||record.securityState||'Secure session')));if(record.cipher)session.append(el('div',record.cipher,'mono'));if(record.keyExchangeGroup||record.keyExchange)session.append(el('div',record.keyExchangeGroup||record.keyExchange,'muted'));
      top.append(request,session);content.append(top);
      const chain=Array.isArray(record.certificateChain)&&record.certificateChain.length?record.certificateChain:[{position:'leaf',commonName:record.subjectName,issuerText:record.issuer,validFrom:record.validFrom,validTo:record.validTo,fingerprint256:record.leafFingerprint256,pemPath:record.leafPemPath,ctSearchUrl:record.leafCtSearchUrl,subjectAltName:Array.isArray(record.subjectAlternativeNames)?record.subjectAlternativeNames.join(', '):''}];
      const chainWrap=el('section',null,'chain'),tree=el('ol',null,'cert-tree');chainWrap.append(tree);let level=tree;
      const ordered=chain.map((cert:any,index:number)=>({cert,role:cert.position||(index===0?'leaf':index===chain.length-1?'root':'intermediate')})).reverse();
      ordered.forEach(({cert,role}:{cert:any;role:string},index:number)=>{
        const info=roleInfo(role);
        const card=el('article',null,'panel cert '+role),head=el('div',null,'cert-head'),icon=el('span',info[0],'cert-icon'),title=el('div',null,'cert-title');
        title.append(el('strong',cert.commonName||cert.subjectText||record.subjectName||'Unnamed certificate'),el('span',info[1],'muted'));
        const actions=el('div',null,'actions'),pem=cert.pem?URL.createObjectURL(new Blob([cert.pem],{type:'application/x-pem-file'})):undefined;
        if(pem){const link=el('a','⤓ PEM','button');urls.push(pem);link.href=pem;link.download='certificate.pem';actions.append(link)}
        let ct=cert.ctSearchUrl;const fingerprint=String(cert.fingerprint256||'').replace(/:/g,'').trim().toLowerCase();if(/^[a-f0-9]{64}$/.test(fingerprint))ct='https://ctlogs.dev/search?q='+encodeURIComponent(fingerprint);
        if(ct)actions.append(safeLink(ct,'◫ CT logs'));head.append(icon,title,actions);card.append(head);
        const fields=el('dl');
        const add=(label:string,value:any,kind?:string)=>{if(value===undefined||value===null||value==='')return;fields.append(el('dt',label));const dd=el('dd');if(kind==='hash')appendCopy(dd,value);else dd.textContent=kind==='date'?fmtDate(value):String(value);fields.append(dd)};
        add('Subject',cert.subjectText||cert.commonName);add('Issuer',cert.issuerText||cert.issuerCommonName||record.issuer);add('Valid from',cert.validFrom,'date');add('Valid until',cert.validTo,'date');add('Serial',cert.serialNumber,'hash');add('SHA-256',cert.fingerprint256||(role==='leaf'&&record.leafFingerprint256),'hash');fields.childElementCount&&card.append(fields);
        const sans=String(cert.subjectAltName||'').replace(/^DNS:/,'').split(/,\s*DNS:/).filter(Boolean);if(!sans.length&&role==='leaf'&&Array.isArray(record.subjectAlternativeNames))sans.push(...record.subjectAlternativeNames);if(sans.length){const list=el('div',null,'sans');sans.forEach(name=>list.append(el('span','⌁ '+name,'badge')));card.append(list)}
        const branch=el('li');branch.append(card);level.append(branch);if(index<ordered.length-1){const children=el('ol',null,'cert-tree');branch.append(children);level=children;}
      });content.append(chainWrap);
      const facts=el('div',null,'badges');[['CT',record.certificateTransparencyCompliance],['Signature',record.serverSignatureAlgorithm],['ECH',typeof record.encryptedClientHello==='boolean'?(record.encryptedClientHello?'yes':'no'):'']].forEach(([label,value])=>{if(value!==''&&value!=null)facts.append(el('span',label+' · '+value,'badge'))});if(facts.childElementCount)content.append(facts);
      if(recordIndex<records.length-1)content.append(el('hr'));
    });

 return()=>{for(const url of urls)URL.revokeObjectURL(url)};
}
