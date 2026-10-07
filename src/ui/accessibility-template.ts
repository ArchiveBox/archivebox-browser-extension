/** Compiled original Accessibility full.html script; receives the preserved
 * CDP/DOM-derived canonical JSON model through the shared WACZ wrapper. */
export function initializeAccessibility(document:Document,data:Record<string,any>,options?:{preview?:boolean}){
  const el=<T extends keyof HTMLElementTagNameMap>(tag:T,text?:unknown,cls?:string)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n};const content=document.getElementById('content')!;
  const icons:Record<string,string>={RootWebArea:'🌐',WebArea:'▣',heading:'H',link:'🔗',button:'▰',textbox:'⌨',image:'▧',navigation:'🧭',main:'◆',article:'▤',list:'☷',listitem:'•',table:'▦',row:'—',cell:'□',checkbox:'☑',radio:'◉',dialog:'▣',form:'▱'};
  function countNodes(node:any):number{if(!node||typeof node!=='object')return 0;return 1+(Array.isArray(node.children)?node.children.reduce((sum:number,child:any)=>sum+countNodes(child),0):0)}
  function nodeTree(node:any,depth=0):HTMLLIElement{
    const li=el('li'),details=el('details');details.open=depth<2;
    const heading=el('summary'),role=String(node?.role||'node');
    heading.append(el('span',icons[role]||icons[role.toLowerCase()]||'◇'),el('span',role,'badge role'),el('span',node?.name||node?.value||'(unnamed)','node-name'));details.append(heading);
    // Closed branches have no visible content. Materialize their unchanged
    // properties and children when opened instead of building tens of
    // thousands of hidden nodes while other snapshot outputs are loading.
    const populate=()=>{
      if(!details.open)return;
      details.removeEventListener('toggle',populate);
      const props=el('div',null,'properties'),ignored=new Set(['role','name','children','loaderId']);
      for(const [key,value] of Object.entries(node||{})){
        if(ignored.has(key)||value===undefined||value===null||value===''||value===false)continue;
        const shown=typeof value==='object'?JSON.stringify(value):String(value);
        const property=el('span',value===true?`✓ ${key}`:`${key}: ${shown}`,'badge property');property.title=`${key}: ${shown}`;props.append(property);
      }
      if(props.childElementCount)details.append(props);
      if(Array.isArray(node?.children)&&node.children.length){const list=el('ul');node.children.forEach((child:any)=>list.append(nodeTree(child,depth+1)));details.append(list)}
    };
    if(details.open)populate();else details.addEventListener('toggle',populate);
    li.append(details);return li;
  }
  function outlineParts(line:unknown):[string,string,number]{const text=String(line||'');const heading=text.match(/^(#{1,6})\s+(.*)$/);if(heading)return [`H${heading[1]!.length}`,heading[2]!,heading[1]!.length-1];const structural=text.match(/^(>+)(\S*)\s*(.*)$/);if(structural){const path=structural[2]!.split('>').filter(Boolean);return [path.at(-1)||'section',structural[3]!.replace(/^:\s*/,''),structural[1]!.length]}return ['•',text,0]}
    const headings=Array.isArray(data.headings)?data.headings:[],frames=Array.isArray(data.iframes)?data.iframes:[],nodes=countNodes(data.tree);
    const overview=el('section',null,'panel');overview.append(el('h2','Page semantics'),el('div',data.url||'','url'));const badges=el('div',null,'badges');if(data.tree!==undefined)badges.append(el('span',`◇ ${nodes} AX nodes`,'badge'));badges.append(el('span',`H ${headings.length} outline entries`,'badge'),el('span',`▣ ${frames.length} frames`,'badge'));overview.append(badges);content.append(overview);
    if(data.tree!==undefined){const treePanel=el('section',null,'panel');treePanel.append(el('h2','Accessibility tree'));if(data.tree){const tree=el('ul',null,'ax');tree.append(nodeTree(data.tree));treePanel.append(tree)}content.append(treePanel);}
    if(headings.length){const panel=el('section',null,'panel');panel.append(el('h2','Document outline'));const list=el('div',null,'outline');(options?.preview?headings.slice(0,12):headings).forEach((line:unknown)=>{const [kind,label,depth]=outlineParts(line),row=el('div',null,'outline-row');row.style.marginLeft=`${Math.min(depth,6)*12}px`;row.append(el('span',kind,'badge'),el('span',label));list.append(row)});panel.append(list);content.append(panel)}
    if(frames.length){const panel=el('section',null,'panel');panel.append(el('h2','Frame tree'));const list=el('div',null,'frames');(options?.preview?frames.slice(0,4):frames).forEach((frame:unknown)=>{const raw=String(frame||''),depth=(raw.match(/^>+/)||[''])[0]!.length,url=raw.slice(depth),row=el('div',null,'frame');row.style.marginLeft=`${Math.min(depth,8)*16}px`;row.append(el('span',depth?'↳':'▣'),el('span',url||'about:blank'));list.append(row)});panel.append(list);content.append(panel)}
}
