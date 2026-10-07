import {Zip,ZipPassThrough} from 'fflate';
import type {GitRepository} from './runtime';
/** Native checkout export is generated only on request. Git symlinks contain
 * their link text and carry Unix type bits; executables retain their mode. */
export function checkoutZip(repository:GitRepository):Promise<Blob>{
 return new Promise((resolve,reject)=>{
  const chunks:BlobPart[]=[];
  const zip=new Zip((error,data,final)=>{if(error){reject(error);return}chunks.push(data as BlobPart);if(final)resolve(new Blob(chunks,{type:'application/zip'}))});
  void(async()=>{for(const path of await repository.listAll()){
    const file=new ZipPassThrough('git/'+path),mode=repository.files.find(file=>file.path===path)?.mode;
    file.os=3;file.attrs=((mode?parseInt(mode,8):0o100644)<<16)>>>0;
    zip.add(file);file.push(await repository.read(path),true);
  }zip.end()})().catch(error=>{zip.terminate();reject(error)});
 });
}
