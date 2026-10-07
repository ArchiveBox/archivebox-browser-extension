// Source-port of vendor/archivebox/plugins/git/full.html; data and file URLs supplied from captured Git objects.
export function initializeGit(document,captures,options){
 const byId=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n};
 const relative=file=>file.root?file.path:file.plugin+'/'+file.path;
 const valid=path=>!path.startsWith('/')&&!path.split('/').some(part=>part==='..'||part==='.'||part==='');
 const fileURL=path=>new URL(options.fileURL(path.replace(/^git\//,'')));
 const files=[...new Map(captures.filter(f=>f.plugin==='git').map(f=>({...f,path:relative(f).replace(/^git\//,'')})).filter(f=>valid(f.path)&&!f.path.split('/').includes('.git')&&!/^on_Snapshot__|^git\.jsonl$/.test(f.path)).map(f=>[f.path,f])).values()];
 byId('files').href='#';byId('files').onclick=event=>{event.preventDefault();options.openFiles()};
 const source=options.source;try{const url=new URL(source);if(['http:','https:'].includes(url.protocol)){byId('source').href=url.href;byId('source').hidden=false;const parts=url.pathname.split('/').filter(Boolean);byId('name').textContent=parts.slice(0,2).join(' / ').replace(/\.git$/,'')||url.hostname}}catch{}
 document.title=byId('name').textContent+' · Archived repository';
 const disposeFiles=options.mountFiles(byId('entries'),files);
 const readme=files.filter(f=>/^(readme(?:\.(md|markdown|rst|txt))?)$/i.test(f.path)).sort((a,b)=>Number(!/\.md$/i.test(a.path))-Number(!/\.md$/i.test(b.path)))[0];if(readme){const url=fileURL('git/'+readme.path);byId('readme').hidden=false;byId('readme-link').textContent=readme.path;byId('readme-link').href=url.href;const frame=el('iframe');frame.title=readme.path;frame.loading='lazy';frame.setAttribute('sandbox','');frame.src=url.href;byId('readme').append(frame)}
 // Parse one already-captured page inertly; never run its scripts or load its assets.
 const page=options.page;
 if(page){Promise.resolve(page).then(text=>{const doc=new DOMParser().parseFromString(text,'text/html');const description=doc.querySelector('.f4.my-3')?.textContent.trim()||doc.querySelector('meta[name="description"]')?.content||doc.querySelector('meta[property="og:description"]')?.content;if(description)byId('description').textContent=description;const star=doc.querySelector('#repo-stars-counter-star, [href$="/stargazers"] .Counter, [href$="/stargazers"] strong');if(star){byId('stars').textContent='☆ '+(star.getAttribute('title')||star.textContent).trim()+' stars';byId('stars').hidden=false}const topics=new Set([...doc.querySelectorAll('a.topic-tag, a[data-octo-click="topic_click"]')].map(n=>n.textContent.trim()).filter(Boolean));for(const topic of [...topics].slice(0,20))byId('topics').append(el('span',topic,'topic'))}).catch(()=>{})}
 return disposeFiles;
}

export async function initializeGitCard(document,captures,options){
const byId=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n};
 const relative=file=>file.root?file.path:file.plugin+'/'+file.path;
 const valid=path=>!path.startsWith('/')&&!path.split('/').some(part=>part==='..'||part==='.'||part==='');

 const files=[...new Map(captures.filter(f=>f.plugin==='git').map(f=>({...f,path:relative(f).replace(/^git\//,'')})).filter(f=>valid(f.path)&&!f.path.split('/').includes('.git')&&!/^on_Snapshot__|^git\.jsonl$/.test(f.path)).map(f=>[f.path,f])).values()];

byId('count').textContent=files.length+' captured files';
try{const url=new URL(options.source);byId('name').textContent=url.pathname.split('/').filter(Boolean).slice(0,2).join(' / ').replace(/\.git$/,'')||url.hostname}catch{}
 // Parse one already-captured page inertly; never run its scripts or load its assets.
 const page=options.page;
 if(page){await Promise.resolve(page).then(text=>{const doc=new DOMParser().parseFromString(text,'text/html');const description=doc.querySelector('.f4.my-3')?.textContent.trim()||doc.querySelector('meta[name="description"]')?.content||doc.querySelector('meta[property="og:description"]')?.content;if(description)byId('description').textContent=description;const star=doc.querySelector('#repo-stars-counter-star, [href$="/stargazers"] .Counter, [href$="/stargazers"] strong');if(star){byId('stars').textContent='☆ '+(star.getAttribute('title')||star.textContent).trim()+' stars';byId('stars').hidden=false}const topics=new Set([...doc.querySelectorAll('a.topic-tag, a[data-octo-click="topic_click"]')].map(n=>n.textContent.trim()).filter(Boolean));for(const topic of [...topics].slice(0,20))byId('topics').append(el('span',topic,'topic'))}).catch(()=>{})}

}
