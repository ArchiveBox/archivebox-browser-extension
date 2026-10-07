import type { ViewContext, ViewResult } from '@/src/archive/views';
export default async function({ archive, url, capture }: ViewContext): Promise<ViewResult> {
  const urls = new Set<string>();
  for (const hook of capture?.hooks || []) if (hook.plugin === 'favicon') for (const record of hook.records || []) urls.add(record.url);
  try {
    const doc = await archive.dom();
    const base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || url, url).href;
    for (const link of doc.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')) {
      const href = link.getAttribute('href');
      if (href) { try { urls.add(new URL(href, base).href); } catch { /* Invalid original icon URL. */ } }
    }
  } catch { /* Non-HTML captures can still include the conventional favicon. */ }
  try { urls.add(new URL('/favicon.ico', url).href); } catch { /* Non-HTTP page URI. */ }
  const sections: ViewResult['sections'] = [];
  for (const icon of urls) {
    const entry = archive.find(icon);
    if (!entry || entry.status < 200 || entry.status >= 300) continue;
    const { headers } = await archive.headers(entry);
    const mime = (Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || entry.mime).split(';')[0]!.trim();
    if (mime.startsWith('image/')) sections.push({ type: 'resource', title: icon, entry: { ...entry, mime } });
  }
  return { title: 'Favicons', summary: sections.length + ' icons', sections };
}
