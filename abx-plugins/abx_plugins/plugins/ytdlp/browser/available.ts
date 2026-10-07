import type {ViewContext} from '@/src/archive/views';
export default ({archive,capture}:ViewContext)=>archive.entries.some(entry=>entry.status===200&&(/^(audio|video)\//.test(entry.mime)||/mpegurl|dash\+xml/.test(entry.mime)))||!!capture?.hooks.some(hook=>hook.plugin==='ytdlp'&&!['noresults','skipped'].includes(hook.status)&&hook.records?.length);
