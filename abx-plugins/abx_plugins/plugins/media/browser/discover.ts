export function discoverMedia(document:Document,base:string):{url:string;kind:string}[] {
  const found=new Map<string,{url:string;kind:string}>();
  function add(raw:unknown,kind:string){if(typeof raw!=='string'||!raw||found.size>=2000)return;try{const url=new URL(raw,base);url.hash='';if(/^https?:$/.test(url.protocol))found.set(url.href,{url:url.href,kind});}catch{}}
  for(const element of document.querySelectorAll('video,audio')) {
    add((element as HTMLMediaElement).currentSrc||element.getAttribute('src'),element.localName);
    add(element.getAttribute('poster'),'poster');
    for(const source of element.querySelectorAll('source,track'))add(source.getAttribute('src'),source.localName==='track'?'track':element.localName);
  }
  for(const element of document.querySelectorAll('meta[property^="og:video"],meta[property^="og:audio"],meta[name="twitter:player:stream"]'))add(element.getAttribute('content'),'metadata');
  for(const element of document.querySelectorAll('a[href]'))if(/\.(?:mp4|webm|og[gv]|mp3|m4a|wav|m3u8|mpd|vtt)(?:[?#]|$)/i.test(element.getAttribute('href')||''))add(element.getAttribute('href'),'linked media');
  function visit(value:any,depth=0){if(!value||depth>20)return;if(Array.isArray(value)){value.forEach(item=>visit(item,depth+1));return;}if(typeof value!=='object')return;
    const types=[value['@type']].flat();if(types.some(type=>/^(?:VideoObject|AudioObject)$/.test(type))){add(value.contentUrl,'structured media');add(value.thumbnailUrl,'poster');}
    for(const child of Object.values(value))if(typeof child==='object')visit(child,depth+1);
  }
  for(const script of document.querySelectorAll('script[type="application/ld+json"]'))try{visit(JSON.parse(script.textContent||''));}catch{}
  return [...found.values()];
}
