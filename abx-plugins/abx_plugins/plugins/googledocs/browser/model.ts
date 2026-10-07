import type {ViewContext} from '@/src/archive/views';
import type {GoogleExports} from './on_Snapshot__53_googledocs';

export function exportEvidence({capture,archive}:ViewContext){
  const hook=capture?.hooks.find(hook=>hook.plugin==='googledocs') || archive.metadata?.plugins?.find((plugin:{id:string})=>plugin.id==='googledocs')?.hooks?.[0];
  return hook?.data as GoogleExports|undefined;
}
