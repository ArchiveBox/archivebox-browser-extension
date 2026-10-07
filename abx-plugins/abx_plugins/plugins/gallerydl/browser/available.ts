import type {ViewContext} from '@/src/archive/views';
export default ({capture}:ViewContext)=>!!capture?.hooks.some(hook=>hook.plugin==='gallerydl'&&!['noresults','skipped'].includes(hook.status)&&hook.records?.length);
