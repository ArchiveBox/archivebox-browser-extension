import type {ViewContext} from '@/src/archive/views';
export default ({capture}:ViewContext)=>!!capture?.hooks.some(hook=>hook.plugin==='git'&&hook.status==='succeeded'&&hook.records?.length);
