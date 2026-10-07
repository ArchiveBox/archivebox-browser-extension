import type {ItemType} from 'replaywebpage';
import {Replay} from '../../vendor/replaywebpage/replay';
import type {ArchiveReader} from './reader';
import {mountReplay} from './replay';
import {playerURL} from '../replay/client';

const collections=new WeakMap<ArchiveReader,Promise<ItemType>>();
/** The same upstream replay component supplies the visible page and derivations. */
export async function createReplay(archive:ArchiveReader,url:string,ts?:string){
 let pending=collections.get(archive);
 if(!pending){pending=(async()=>{
  const coll=await mountReplay(archive),apiPrefix=playerURL(`w/api/c/${coll}`);
  const response=await fetch(`${apiPrefix}?all=1`);
  if(!response.ok)throw Error(`Unable to read mounted Webrecorder collection: HTTP ${response.status}`);
  return {...await response.json(),coll,apiPrefix,replayPrefix:playerURL(`w/${coll}`)} as ItemType;
 })();collections.set(archive,pending);pending.catch(()=>collections.delete(archive))}
 const replay=new Replay();replay.collInfo=await pending;
 replay.waczhash=archive.replayHash||'';replay.ts=ts??archive.find(url)?.timestamp??'';replay.url=url;
 return replay;
}
