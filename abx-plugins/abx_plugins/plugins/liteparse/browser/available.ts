import type {ViewContext} from '@/src/archive/views';
export default ({archive}:ViewContext)=>archive.entries.some(entry=>entry.url.startsWith('urn:ocr:'));
