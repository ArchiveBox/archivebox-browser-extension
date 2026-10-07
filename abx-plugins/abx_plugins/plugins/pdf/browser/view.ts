import type { ViewContext, ViewResult } from '@/src/archive/views';
export default async function({ archive, url,capture }: ViewContext): Promise<ViewResult> {
  const entry = archive.artifact('pdf') || archive.entries.find(item => item.url === url && item.mime === 'application/pdf');
  const config=capture?.pluginConfig?.pdf||archive.metadata?.plugins?.find((plugin:{id:string})=>plugin.id==='pdf')?.config||{};
  return { title: 'PDF', summary:'', sections: entry ? [{ type: 'resource', title: 'PDF document', entry }] : [],presentation:entry?undefined:{type:'lazy-pdf',landscape:config.PDF_LANDSCAPE===true} };
}
