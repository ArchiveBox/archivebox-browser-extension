import { createSnapshot } from './snapshots';
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
    throw new Error('Start date must be before end date');
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
