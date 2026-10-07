import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/sslcerts/full.html?raw';
import {initializeSSLCerts} from '@/src/ui/sslcerts-template';
import {X509Certificate,SubjectAlternativeNameExtension} from '@peculiar/x509';
export default async function({archive,preview}:ViewContext):Promise<ViewResult>{
  const entry=archive.artifact('sslcerts');
  if(!entry)return {title:'SSL Certificates',summary:'No saved TLS certificate evidence.',sections:[],presentation:{type:'canonical',plugin:'sslcerts',title:'SSL Certificates',template,data:[],format:'jsonl',initialize:initializeSSLCerts}};
  const original=await archive.json(entry);const connections=preview?(original.connections||[]).slice(0,1):(original.connections||[]);const origins=new Set(connections.map((connection:any)=>new URL(connection.url).origin));const chains=new Map<string,any[]>();const errors:string[]=[];
  for(const saved of (original.certificates || []).filter((saved:any)=>origins.has(saved.origin))){const chain:any[]=[];for(const [index,encoded]of (saved.tableNames || []).entries())try{
    // Original browser DER is parsed at view time by the upstream JS X.509 library.
    const cert=new X509Certificate(encoded);const fingerprint256=Array.from(new Uint8Array(await cert.getThumbprint('SHA-256')),byte=>byte.toString(16).padStart(2,'0')).join('');
    chain.push({position:index===0?'leaf':index===saved.tableNames.length-1?'root':'intermediate',subjectText:cert.subject,issuerText:cert.issuer,commonName:cert.subjectName.getField('CN')[0] || '',issuerCommonName:cert.issuerName.getField('CN')[0] || '',subjectAltName:(cert.getExtension(SubjectAlternativeNameExtension)?.names.toJSON() || []).map(name=>(name.type==='dns'?'DNS:':name.type+':')+name.value).join(', '),serialNumber:cert.serialNumber,validFrom:cert.notBefore.valueOf()/1000,validTo:cert.notAfter.valueOf()/1000,fingerprint256,pem:cert.toString('pem')});
  }catch(error){errors.push(`${saved.origin}: ${error}`);}chains.set(saved.origin,chain);}
  const records=connections.map((connection:any)=>({...connection.securityDetails,url:connection.url,securityState:connection.securityState,subjectAlternativeNames:connection.securityDetails?.sanList || [],certificateChain:chains.get(new URL(connection.url).origin) || []}));
  if(errors.length)throw Error(errors.join('\n'));
  return {title:'SSL Certificates',summary:'',sections:[],presentation:{type:'canonical',plugin:'sslcerts',title:'SSL Certificates',template,data:records,format:'jsonl',initialize:initializeSSLCerts}};
}
