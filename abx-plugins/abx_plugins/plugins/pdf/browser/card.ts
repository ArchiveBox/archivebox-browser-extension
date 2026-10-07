import type {ViewContext} from '@/src/archive/views';
import {mountReplay,recordURL} from '@/src/archive/replay';
import template from '@/vendor/archivebox/plugins/pdf/card.html?raw';
export default async function({archive}:ViewContext){await mountReplay(archive);const entry=archive.artifact('screenshot');const doc=new DOMParser().parseFromString(template.replace(/<script>[\s\S]*?<\/script>/,''),'text/html');const image=doc.getElementById('preview') as HTMLImageElement|null;if(image&&entry){image.src=recordURL(archive,entry);image.style.display='block';doc.getElementById('fallback')?.setAttribute('hidden','')}return '<!doctype html>'+doc.documentElement.outerHTML}
