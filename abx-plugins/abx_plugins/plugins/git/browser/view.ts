import type {ViewContext,ViewResult} from '@/src/archive/views';
import {cloneGit,normalizeGitURL,gitDomains,type GitRepository} from '@/vendor/git/runtime';
import {createArchivedTransport} from '@/vendor/python/transport';
export type GitPresentation={type:'git';repository:GitRepository|null;source:string;page:string};
export default async function({archive,capture,url,signal}:ViewContext):Promise<ViewResult>{
  const plugin=archive.metadata?.plugins?.find((item:any)=>item.id==='git');
  const hooks=plugin?.hooks||(capture?.hooks||[]).filter(hook=>hook.plugin==='git');
  const remote=normalizeGitURL(url,String(plugin?.config?.GIT_DOMAINS||capture?.pluginConfig?.git?.GIT_DOMAINS||gitDomains));
  const refs=hooks.flatMap(hook=>hook.records||[]);
  let repository:GitRepository|null=null;
  if(remote&&refs.length&&hooks.some(hook=>hook.status==='succeeded'))repository=await cloneGit(remote,await createArchivedTransport(archive,refs),{signal});
  // The canonical renderer only parses metadata inertly. Preserve the head's
  // description instead of passing it through the displayed-HTML sanitizer.
  const dom=archive.documentEntry();const page=dom&&/html/i.test(dom.mime)?await archive.text(dom):'';
  return {title:'Git',summary:'',sections:[],presentation:{type:'git',repository,source:url,page}};
}
