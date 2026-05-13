import type { ArchiveDepth, Snapshot } from './types';

export function createSnapshot(
  url: string,
  tags: string[] = [],
  title = '',
  favIconUrl: string | null = null,
  depth: ArchiveDepth = 0,
): Snapshot {
  return {
    id: crypto.randomUUID(),
    url,
    timestamp: new Date().toISOString(),
    tags,
    title,
    favIconUrl,
    depth,
  };
}

export function filterSnapshots(snapshots: Snapshot[], filterText: string): Snapshot[] {
  if (!filterText.trim()) return snapshots;

  const searchTerms = filterText.toLowerCase().split(/\s+/).filter(Boolean);
  return snapshots.filter((snapshot) => {
    const searchableText = [
      snapshot.url,
      snapshot.title,
      snapshot.id,
      snapshot.timestamp,
      ...snapshot.tags,
    ]
      .join(' ')
      .toLowerCase();

    return searchTerms.every((term) => searchableText.includes(term));
  });
}

export function uniqueTags(snapshots: Snapshot[]): string[] {
  return [...new Set(snapshots.flatMap((snapshot) => snapshot.tags))]
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
