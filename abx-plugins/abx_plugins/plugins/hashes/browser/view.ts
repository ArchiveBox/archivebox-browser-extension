import type {ViewContext,ViewResult} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/hashes/full.html?raw';
import {initializeHashes} from '@/src/ui/hashes-template';
export default async function({archive,preview}:ViewContext):Promise<ViewResult>{
  return {title:'Hashes',summary:'',sections:[],presentation:{type:'canonical',plugin:'hashes',title:'Hashes',template,data:await archive.integrityTree({includeRecords:!preview}),initialize:initializeHashes,format:'json',filename:'hashes.json'}};
}
