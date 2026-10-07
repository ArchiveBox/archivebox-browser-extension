import type {ViewContext} from './views';

/** Cheap plugin-owned checks over capture metadata/indexes and headers. Unknown
 * availability stays visible; no output is discarded or interpreter started. */
const checks=import.meta.glob('../../abx-plugins/abx_plugins/plugins/*/browser/available.ts',{eager:true,import:'default'}) as Record<string,(context:ViewContext)=>boolean|Promise<boolean>>;
export function hasOutput(name:string,context:ViewContext){
 return checks[`../../abx-plugins/abx_plugins/plugins/${name}/browser/available.ts`]?.(context)??true;
}
