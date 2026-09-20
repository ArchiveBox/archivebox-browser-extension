import { createSnapshot } from './snapshots';
import { t } from './i18n';
import type { Snapshot } from './types';

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export async function loadHistorySnapshots(
  startDateValue: string,
  endDateValue: string,
  existingUrls: Set<string>,
): Promise<Array<Snapshot & { selected: boolean; isNew: boolean }>> {
  const startDate = parseLocalDate(startDateValue);
  const endDate = parseLocalDate(endDateValue);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  if (startDate > endDate) {
    throw new Error(t("Start date must be before end date"));
  }

  const historyItems = await browser.history.search({
    text: '',
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
    maxResults: 10000,
  });

  return historyItems.map((item) => ({
    ...createSnapshot(item.url || '', [], item.title || ''),
    timestamp: new Date(item.lastVisitTime || Date.now()).toISOString(),
    selected: false,
    isNew: !existingUrls.has(item.url || ''),
  }));
}

export async function loadBookmarkSnapshots(
  existingUrls: Set<string>,
): Promise<Array<Snapshot & { selected: boolean; isNew: boolean }>> {
  function walk(nodes: Browser.bookmarks.BookmarkTreeNode[]): Array<Snapshot & {
    selected: boolean;
    isNew: boolean;
  }> {
    return nodes.flatMap((node) => {
      const entries: Array<Snapshot & { selected: boolean; isNew: boolean }> = [];
      if (node.url) {
        entries.push({
          ...createSnapshot(node.url, [], node.title || ''),
          selected: false,
          isNew: !existingUrls.has(node.url),
        });
      }
      if (node.children) entries.push(...walk(node.children));
      return entries;
    });
  }

  return walk(await browser.bookmarks.getTree());
}

export type SafariImportSource = 'all' | 'bookmarks' | 'readingList' | 'history';
type ExportedPage = { url: string; title: string; timestamp?: string; source: Exclude<SafariImportSource, 'all'> };

// Safari has no WebExtension bookmarks/history API. Parse the user's explicit
// export locally, then reuse the same review, deduplication, and save flow.
export async function loadSafariExportSnapshots(
  files: File[], source: SafariImportSource, startDateValue: string, endDateValue: string,
  existingUrls: Set<string>,
): Promise<Array<Snapshot & { selected: boolean; isNew: boolean }>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const maxBytes = 64 * 1024 * 1024;
  let totalBytes = 0;
  let recognized = false;
  const pages: ExportedPage[] = [];
  const startDate = parseLocalDate(startDateValue);
  const endDate = parseLocalDate(endDateValue);
  endDate.setHours(23, 59, 59, 999);
  if (startDate > endDate) throw new Error(t('Start date must be before end date'));

  function parse(text: string, name: string) {
    if (/\.html?$/i.test(name) && /^\s*<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(text)) {
      recognized = true;
      // An inert document: never insert exported markup into the options page.
      const document = new DOMParser().parseFromString(text, 'text/html');
      const readingLists = [...document.querySelectorAll('[id="com.apple.ReadingList"]')]
        .map(heading => heading.nextElementSibling).filter(element => element?.tagName === 'DL');
      for (const link of document.querySelectorAll('a[href]')) {
        const added = Number(link.getAttribute('add_date')) * 1000;
        pages.push({
          url: link.getAttribute('href') || '', title: link.textContent?.trim() || '',
          source: readingLists.some(list => list?.contains(link)) ? 'readingList' : 'bookmarks',
          timestamp: added > 0 && Number.isFinite(new Date(added).getTime()) ? new Date(added).toISOString() : undefined,
        });
      }
    } else if (/\.json$/i.test(name)) {
      const data = JSON.parse(text);
      // Recognize by content, not localized filenames or Safari profile names.
      // In particular, never import URL fields from password/card/extension data.
      if (data?.metadata?.data_type !== 'history' || !Array.isArray(data.history)) return;
      recognized = true;
      for (const item of data.history) {
        const visited = typeof item.time_usec === 'number' ? item.time_usec / 1000 : NaN;
        if (typeof item.url !== 'string' || !Number.isFinite(visited) || !Number.isFinite(new Date(visited).getTime())) continue;
        pages.push({ url: item.url, title: typeof item.title === 'string' ? item.title : '', source: 'history', timestamp: new Date(visited).toISOString() });
      }
    }
  }

  for (const file of files) {
    if (file.size > maxBytes) throw new Error(t('Safari export exceeds the 64 MB import limit.'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      const contents = unzipSync(bytes, { filter: entry => {
        if (entry.name.startsWith('__MACOSX/') || entry.name.split('/').some(part => part.startsWith('.')) || !/\.(html?|json)$/i.test(entry.name)) return false;
        totalBytes += entry.originalSize;
        if (totalBytes > maxBytes) throw new Error(t('Safari export exceeds the 64 MB import limit.'));
        return true;
      } });
      for (const [name, content] of Object.entries(contents)) parse(strFromU8(content), name);
    } else {
      totalBytes += bytes.length;
      if (totalBytes > maxBytes) throw new Error(t('Safari export exceeds the 64 MB import limit.'));
      parse(strFromU8(bytes), file.name);
    }
  }
  if (!recognized) throw new Error(t('No Safari bookmarks, Reading List, or history found in these files.'));
  const unique = new Map<string, ExportedPage>();
  // Prefer bookmark titles over Reading List/history when the same URL occurs
  // in more than one file. Do not depend on the order of ZIP entries.
  const priority = { bookmarks: 0, readingList: 1, history: 2 };
  for (const page of pages.sort((a, b) => priority[a.source] - priority[b.source])) {
    if (source !== 'all' && page.source !== source) continue;
    if (page.source === 'history' && (!page.timestamp || new Date(page.timestamp) < startDate || new Date(page.timestamp) > endDate)) continue;
    let url: URL;
    try { url = new URL(page.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    if (!unique.has(url.href)) unique.set(url.href, { ...page, url: url.href });
  }
  return [...unique.values()].map(page => ({
    ...createSnapshot(page.url, [], page.title),
    ...(page.timestamp ? { timestamp: page.timestamp } : {}),
    selected: false, isNew: !existingUrls.has(page.url),
  }));
}
