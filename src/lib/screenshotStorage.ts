import type { Snapshot, SnapshotMhtml, SnapshotScreenshot, SnapshotSingleFile } from './types';
import { t } from './i18n';

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
  return `${year}${month}${day}`;
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

export function snapshotMhtmlPath(snapshot: Snapshot): string {
  return [
    'snapshots',
    snapshotDateSegment(snapshot),
    snapshotHostSegment(snapshot),
    pathSafeSegment(snapshot.id),
    'chrome_extension_mhtml',
    'snapshot.mhtml',
  ].join('/');
}

export function snapshotSingleFilePath(snapshot: Snapshot): string {
  return [
    'snapshots',
    snapshotDateSegment(snapshot),
    snapshotHostSegment(snapshot),
    pathSafeSegment(snapshot.id),
    'chrome_extension_singlefile',
    'singlefile.html',
  ].join('/');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getDirectory(pathSegments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error(t("Local capture storage is not available in this browser."));
  }

  let directory = await navigator.storage.getDirectory();
  for (const segment of pathSegments) {
    try {
      directory = await directory.getDirectoryHandle(segment, { create });
    } catch (error) {
      throw new Error(t("Unable to open local capture directory: $1", segment, errorMessage(error)));
    }
  }
  return directory;
}

async function writeBytesToFile(directory: FileSystemDirectoryHandle, fileName: string, bytes: ArrayBuffer): Promise<void> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await directory.getFileHandle(fileName, { create: true });
  } catch (error) {
    throw new Error(t("Unable to open local capture file: $1", fileName, errorMessage(error)));
  }

  let writable: FileSystemWritableFileStream;
  try {
    writable = await fileHandle.createWritable();
  } catch (error) {
    throw new Error(t("Unable to create local capture writer: $1", fileName, errorMessage(error)));
  }

  try {
    await writable.write(bytes);
  } catch (error) {
    throw new Error(t("Unable to write local capture file: $1", fileName, errorMessage(error)));
  } finally {
    await writable.close().catch(() => undefined);
  }
}

async function writeBlobToFile(directory: FileSystemDirectoryHandle, fileName: string, blob: Blob): Promise<void> {
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch (error) {
    throw new Error(t("Unable to read local capture file: $1", fileName, errorMessage(error)));
  }
  await writeBytesToFile(directory, fileName, bytes);
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
  if (!fileName) throw new Error(t("Invalid local screenshot path."));

  const directory = await getDirectory(segments, true);
  await writeBlobToFile(directory, fileName, blob);

  return {
    storage: 'opfs',
    path,
    mimeType: 'image/png',
    capturedAt: new Date().toISOString(),
    width,
    height,
  };
}

export async function writeSnapshotMhtml(
  snapshot: Snapshot,
  content: string,
): Promise<SnapshotMhtml> {
  return writeSnapshotMhtmlBlob(snapshot, new Blob([content], { type: 'multipart/related' }));
}

export async function writeSnapshotMhtmlBlob(
  snapshot: Snapshot,
  blob: Blob,
): Promise<SnapshotMhtml> {
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch (error) {
    throw new Error(t("Unable to read local MHTML data: $1", errorMessage(error)));
  }
  return writeSnapshotMhtmlBytes(snapshot, bytes);
}

export async function writeSnapshotMhtmlBytes(
  snapshot: Snapshot,
  bytes: ArrayBuffer,
): Promise<SnapshotMhtml> {
  const path = snapshotMhtmlPath(snapshot);
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error(t("Invalid local MHTML path."));

  const directory = await getDirectory(segments, true);
  await writeBytesToFile(directory, fileName, bytes);

  return {
    storage: 'opfs',
    path,
    mimeType: 'multipart/related',
    capturedAt: new Date().toISOString(),
    size: bytes.byteLength,
  };
}

export async function writeSnapshotSingleFileHtml(
  snapshot: Snapshot,
  content: string,
  filename?: string,
): Promise<SnapshotSingleFile> {
  const bytes = new TextEncoder().encode(content).buffer;
  const path = snapshotSingleFilePath(snapshot);
  const segments = path.split('/');
  const fileName = segments.pop();
  if (!fileName) throw new Error(t("Invalid local SingleFile HTML path."));

  const directory = await getDirectory(segments, true);
  await writeBytesToFile(directory, fileName, bytes);

  return {
    storage: 'opfs',
    path,
    mimeType: 'text/html',
    capturedAt: new Date().toISOString(),
    size: bytes.byteLength,
    filename,
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

export async function readSnapshotMhtmlBlob(mhtml?: SnapshotMhtml): Promise<Blob | null> {
  if (!mhtml?.path) return null;
  const segments = mhtml.path.split('/');
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

export async function readSnapshotSingleFileBlob(singlefile?: SnapshotSingleFile): Promise<Blob | null> {
  if (!singlefile?.path) return null;
  const segments = singlefile.path.split('/');
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
