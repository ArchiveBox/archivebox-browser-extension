import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/accessibility/full.html?raw';
import {initializeAccessibility} from '@/src/ui/accessibility-template';
import {cardDOM} from '@/src/archive/cards';
import {accessibilityTree,type AXNode} from '@/src/archive/print';
const role = (node: AXNode) => String(node.role?.value || 'node');
const name = (node: AXNode) => String(node.name?.value ?? '');
export default async function({archive,url,signal,preview}:ViewContext):Promise<ViewResult>{
 const tree=preview?{nodes:[] as AXNode[]}:await accessibilityTree(archive,url,signal||new AbortController().signal);
 if(!preview&&!tree.nodes?.length)throw Error('Chrome returned no accessibility nodes');
 const nodes=new Map(tree.nodes.map(node=>[node.nodeId,node]));
  const presentationData:{url:string;tree:any;headings:string[];iframes:string[]}={url,tree:undefined,headings:[],iframes:[]};
  // Flatten native CDP value wrappers into the canonical snapshot shape,
  // preserving Chromium's hierarchy and all exposed properties.
  const mapped=new Map(tree.nodes.map(node=>[node.nodeId,{role:role(node),name:name(node),...(node.value?.value!==undefined?{value:node.value.value}:{}),...(node.ignored?{ignored:true}:{}),...Object.fromEntries((node.properties || []).map(prop=>[prop.name,prop.value.value])),children:[] as any[]}]));
  for(const node of tree.nodes)for(const child of node.childIds || [])if(mapped.has(child))mapped.get(node.nodeId)!.children.push(mapped.get(child));
  const root=tree.nodes.find(node=>!node.parentId || !nodes.has(node.parentId));presentationData.tree=root?mapped.get(root.nodeId):undefined;
  {
    const document = await (preview?cardDOM(archive):archive.dom());
    // Canonical accessibility/on_Snapshot__39_accessibility.js outline formatting.
    for(const element of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a[name],header,footer,article,main,aside,nav,section,figure,summary,table,form,iframe')){
      const tag=element.tagName.toLowerCase(),id=element.id || element.getAttribute('name') || element.getAttribute('aria-label') || element.getAttribute('role') || '';
      const classes=(element.getAttribute('class') || '').trim().split(/\s+/).slice(0,3).join(' .');const action=(element.getAttribute('action') || '').split('/').pop() || '';
      const text=element.textContent || '';let summary=text.slice(0,128);if(summary.length>=128)summary+='...';let prefix='',title='';const level=parseInt(tag.replace('h',''));
      if(!Number.isNaN(level)){prefix='#'.repeat(level);title=text || id || classes;}else{const parents=[tag];let parent=element.parentElement;while(parent&&parents.length<5){const parentTag=parent.tagName.toLowerCase();parents.unshift(['div','span','p','body','html'].includes(parentTag)?'':parentTag);parent=parent.parentElement;}prefix=parents.join('>');title=id?'#'+id:'';if(!title&&classes)title='.'+classes;if(action)title+=' /'+action;if(summary&&!title.includes(summary))title+=': '+summary;}
      title=title.replace(/\s+/g,' ').trim();if(prefix)presentationData.headings.push(prefix+' '+title);
    }
    // Only frame declarations present in the replayed main-frame DOM are known.
    presentationData.iframes=[url,...[...document.querySelectorAll('iframe')].map(frame=>'>'+new URL(frame.getAttribute('src') || 'about:blank',document.baseURI).href)];
  }
 return {title:'Accessibility',summary:'',sections:[],presentation:{type:'canonical',plugin:'accessibility',title:'Accessibility',template,data:presentationData,initialize:initializeAccessibility}};
}
