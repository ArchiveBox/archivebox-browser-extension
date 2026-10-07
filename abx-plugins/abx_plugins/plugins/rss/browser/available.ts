import type {ViewContext} from '@/src/archive/views';
export default ({capture,archive,url}:ViewContext)=>{
 const hooks=capture?.hooks.filter(hook=>hook.plugin==='rss');
 if(!hooks?.length)return true;
 return hooks.some(hook=>hook.records?.length||!['noresults','skipped'].includes(hook.status))||archive.entries.some(entry=>entry.status===200&&(/rss|atom|feed\+json/i.test(entry.mime)||/\.(rss|atom)(?:[?#]|$)/i.test(entry.url)||(entry.url===url&&/xml|json/i.test(entry.mime))));
};
