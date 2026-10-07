import type {ViewContext} from '@/src/archive/views';
import {mountReplay,recordURL} from '@/src/archive/replay';
export default async function({archive}:ViewContext){await mountReplay(archive);const entry=archive.entries.find(entry=>/favicon/.test(entry.url)&&entry.mime.startsWith('image/')),image=document.createElement('img');if(entry)image.src=recordURL(archive,entry);return image.outerHTML}
