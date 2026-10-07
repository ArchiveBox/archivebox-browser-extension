/** Source-faithful ports of abx-plugins base/utils.py:preserve_article_image_dimensions
 * and readability:render_readability_document. See ARTICLE-PROVENANCE.md. */
import {parse,parseFragment,type DefaultTreeAdapterTypes} from 'parse5';
import type {ArchiveReader} from './reader';
import readabilityDocument from '../../abx-plugins/abx_plugins/plugins/readability/templates/content.html?raw';
type Attributes=Record<string,string>;
type Node=DefaultTreeAdapterTypes.Node;
const dimensions=['width','height','max-width','max-height'];
export const escapeArticleHTML=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[char]!));
function sizes(attrs:Attributes){
  const styles:Attributes={};for(const declaration of (attrs.style||'').split(';')){const colon=declaration.indexOf(':');if(colon>=0)styles[declaration.slice(0,colon).trim().toLowerCase()]=declaration.slice(colon+1).trim();}
  const result:Attributes={};for(const name of dimensions){const value=(styles[name]??attrs[name]??'').replace(/\s*!important\s*$/i,'');if(/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|vw|vh)?$/i.test(value))result[name]=/^[\d.]+$/.test(value)?value+'px':value;}
  return result;
}
function* images(node:Node):Generator<DefaultTreeAdapterTypes.Element>{if('tagName' in node&&node.tagName==='img')yield node;if('childNodes' in node)for(const child of node.childNodes)yield* images(child);}
const attrs=(node:DefaultTreeAdapterTypes.Element)=>Object.fromEntries(node.attrs.map(attr=>[attr.name,attr.value]));
const same=(a:Attributes|null,b:Attributes)=>a!==null&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
export function preserveArticleImageDimensions(content:string,source:string,url:string){
  const originals=new Map<string,Attributes|null>();
  for(const image of images(parse(source,{scriptingEnabled:false}))){const attributes=attrs(image);const src=new URL(attributes.src||'',url).href;const size=sizes(attributes);if(!originals.has(src))originals.set(src,size);else if(!same(originals.get(src)!,size))originals.set(src,null);}
  return content.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,tag=>{
    const image=images(parseFragment(tag)).next().value;if(!image)return tag;const attributes=attrs(image);
    const original=originals.get(new URL(attributes.src||'',url).href)||{};const size={...sizes(attributes),...original};if(!Object.keys(size).length)return tag;
    const style=((attributes.style||'').replace(/;+$/,'')+';'+Object.entries(size).map(([key,value])=>`${key}:${value}`).join(';')).replace(/^;+/,'');
    return tag.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\s*\/?>$/,` style="${escapeArticleHTML(style)}">`);
  });
}
/** Native readability's filesystem image lookup adapted to original WACZ responses. */
function linkArchivedImages(content:string,url:string,archive:ArchiveReader){
  content=content.replace(/<img\b[^>]*>/gi,tag=>{
    const image=images(parseFragment(tag)).next().value;if(!image)return '';
    const source=attrs(image).src;if(!source)return '';
    let target:URL;try{target=new URL(source,url);}catch{return '';}
    if(!/^https?:$/.test(target.protocol)||!archive.entries.some(entry=>entry.url===target.href&&entry.status>=200&&entry.status<300))return '';
    return tag.replace(/\bsrc\s*=\s*(["'])([^"']+)\1/i,(_match,quote)=>`src=${quote}${escapeArticleHTML(target.href)}${quote}`).replace(/\s+srcset\s*=\s*(["']).*?\1/gi,'');
  }).replace(/<source\b[^>]*>/gi,'');
  for(const tag of ['picture','a','figure','p'])content=content.replace(new RegExp(`<${tag}\\b[^>]*>\\s*</${tag}>`,'gi'),'');
  return content;
}
export function renderReadabilityDocument(content:string,metadata:{title?:unknown;lang?:unknown},url:string,archive:ArchiveReader){
  return readabilityDocument.replace('{{lang}}',escapeArticleHTML(metadata.lang||'en')).replace('{{title}}',escapeArticleHTML(metadata.title||'')).replace('{{content}}',()=>linkArchivedImages(content,url,archive));
}
