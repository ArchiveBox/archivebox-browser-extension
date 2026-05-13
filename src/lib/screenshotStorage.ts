import type { Snapshot, SnapshotScreenshot } from './types';

function pathSafeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function snapshotDateSegment(snapshot: Snapshot): string {
  const date = new Date(snapshot.timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function snapshotHostSegment(snapshot: Snapshot): string {
  try {
    return pathSafeSegment(new URL(snapshot.url).hostname);
  } catch {
    return 'unknown';
  }
}

export function snapshotScreenshotPath(snapshot: Snapshot): string {
  return [
    'snapshots',
    snapshotDateSegment(snapshot),
    snapshotHostSegment(snapshot),
    pathSafeSegment(snapshot.id),
    'chrome_extension_screenshot',
    'screenshot.png',
  ].join('/');
}

async function getDirectory(pathSegments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let directory = await navigator.storage.getDirectory();
  for (const segment of pathSegments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory;
}

export async function writeSnapshotScreenshot(
  snapshot: Snapshot,
  blob: Blob,
  width: number,
  height: number,
): Promise<SnapshotScreenshot> {
  const path = snapshotScreenshotPath(snapshot);
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error('Invalid screenshot path');

  const directory = await getDirectory(segments, true);
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  return {
    storage: 'opfs',
    path,
    mimeType: 'image/png',
    capturedAt: new Date().toISOString(),
    width,
    height,
  };
}

export async function readSnapshotScreenshotBlob(screenshot?: SnapshotScreenshot): Promise<Blob | null> {
  if (!screenshot?.path) return null;
  const segments = screenshot.path.split('/');
  const fileName = segments.pop();
  if (!fileName) return null;

  try {
    const directory = await getDirectory(segments, false);
    const fileHandle = await directory.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}
