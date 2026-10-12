import type { ArchiveDepth, Snapshot } from './types';
import { uuidv7 } from './uuid';

export function createSnapshot(
  url: string,
  tags: string[] = [],
  title = '',
  favIconUrl: string | null = null,
  depth: ArchiveDepth = 0,
): Snapshot {
  return {
    id: uuidv7(),
    url,
    timestamp: new Date().toISOString(),
    tags,
    title,
    favIconUrl,
    depth,
  };
}
