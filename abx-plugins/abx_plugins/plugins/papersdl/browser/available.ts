import type {ViewContext} from '@/src/archive/views';
export default ({capture,archive}:ViewContext)=>!!capture?.hooks.filter(hook=>hook.plugin==='papersdl').some(hook=>hook.records?.some(ref=>{const entry=archive.find(ref.url,ref.ts);return entry?.mime==='application/pdf'&&entry.status>=200&&entry.status<300}));
