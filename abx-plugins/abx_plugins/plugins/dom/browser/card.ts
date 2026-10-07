import type {ViewContext} from '@/src/archive/views';
import type {ArchiveReader} from '@/src/archive/reader';
import {replayHTML} from '@/src/archive/replay';
const previews=new WeakMap<ArchiveReader,Promise<string>>();
export default function({archive,url}:ViewContext){
 let preview=previews.get(archive);
 if(!preview){const entry=archive.documentEntry();if(!entry)throw Error('No archived HTML');preview=archive.text(entry).then(html=>replayHTML(archive,html,url));previews.set(archive,preview);preview.catch(()=>previews.delete(archive))}
 return preview;
}
