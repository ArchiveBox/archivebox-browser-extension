import type {ViewContext} from '@/src/archive/views';
export async function originalFile({archive,url}:ViewContext){
  let current = url;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const entry = archive.find(current);
    if (!entry) break;
    const { headers } = await archive.headers(entry);
    const header = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    const location = header('location');
    if (entry.status >= 300 && entry.status < 400 && location) {
      try { current = new URL(location, current).href; continue; } catch { break; }
    }
    const mime = (header('content-type') || entry.mime).split(';')[0]!.trim().toLowerCase();
    if (['text/html', 'application/xhtml+xml'].includes(mime)) break;
    if (entry.status < 200 || entry.status >= 300) break;
    return {entry:{...entry,mime},headers,url:current};
  }
  return undefined;
}
