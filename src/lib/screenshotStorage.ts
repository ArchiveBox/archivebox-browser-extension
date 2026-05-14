import type { Snapshot, SnapshotMhtml, SnapshotScreenshot, SnapshotScreenshotPart, SnapshotSingleFile } from './types';
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

export function snapshotDirectoryPath(snapshot: Snapshot): string {
  return [
    'snapshots',
    snapshotDateSegment(snapshot),
    snapshotHostSegment(snapshot),
    pathSafeSegment(snapshot.id),
  ].join('/');
}

export function snapshotScreenshotPath(snapshot: Snapshot, partIndex = 0): string {
  const fileName = partIndex === 0 ? 'screenshot.png' : `screenshot-${partIndex}.png`;
  return [
    'snapshots',
    snapshotDateSegment(snapshot),
    snapshotHostSegment(snapshot),
    pathSafeSegment(snapshot.id),
    'chrome_extension_screenshot',
    fileName,
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

export async function assertLocalCaptureStorageAvailable(): Promise<void> {
  await getDirectory([], true);
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
  return writeSnapshotScreenshotParts(snapshot, [{ blob, x: 0, y: 0, width, height }], width, height);
}

export async function writeSnapshotScreenshotParts(
  snapshot: Snapshot,
  partBlobs: Array<{ blob: Blob; x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
): Promise<SnapshotScreenshot> {
  if (partBlobs.length === 0) throw new Error(t("No screenshot tiles were captured."));
  const firstPath = snapshotScreenshotPath(snapshot, 0);
  const firstSegments = firstPath.split('/');
  const firstFileName = firstSegments.pop();
  if (!firstFileName) throw new Error(t("Invalid local screenshot path."));

  const directory = await getDirectory(firstSegments, true);
  await clearDirectory(directory);
  const parts: SnapshotScreenshotPart[] = [];

  for (const [index, part] of partBlobs.entries()) {
    const path = snapshotScreenshotPath(snapshot, index);
    const fileName = path.split('/').pop();
    if (!fileName) throw new Error(t("Invalid local screenshot path."));
    await writeBlobToFile(directory, fileName, part.blob);
    parts.push({
      path,
      x: part.x,
      y: part.y,
      width: part.width,
      height: part.height,
    });
  }

  return {
    storage: 'opfs',
    path: firstPath,
    parts,
    mimeType: 'image/png',
    capturedAt: new Date().toISOString(),
    width,
    height,
  };
}

export async function appendSnapshotScreenshotParts(
  snapshot: Snapshot,
  existingScreenshot: SnapshotScreenshot,
  partBlobs: Array<{ blob: Blob; x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
): Promise<SnapshotScreenshot> {
  if (partBlobs.length === 0) return existingScreenshot;
  const firstPath = existingScreenshot.path || snapshotScreenshotPath(snapshot, 0);
  const firstSegments = firstPath.split('/');
  firstSegments.pop();
  const directory = await getDirectory(firstSegments, true);
  const existingParts = existingScreenshot.parts?.length
    ? existingScreenshot.parts
    : [{
      path: existingScreenshot.path,
      x: 0,
      y: 0,
      width: existingScreenshot.width,
      height: existingScreenshot.height,
  }];
  const parts: SnapshotScreenshotPart[] = [...existingParts];
  const startIndex = parts.length;

  for (const [index, part] of partBlobs.entries()) {
    const path = snapshotScreenshotPath(snapshot, startIndex + index);
    const fileName = path.split('/').pop();
    if (!fileName) throw new Error(t("Invalid local screenshot path."));
    await writeBlobToFile(directory, fileName, part.blob);
    parts.push({
      path,
      x: part.x,
      y: part.y,
      width: part.width,
      height: part.height,
    });
  }

  return {
    ...existingScreenshot,
    path: firstPath,
    parts,
    capturedAt: new Date().toISOString(),
    width: Math.max(existingScreenshot.width, width),
    height: existingScreenshot.height + height,
  };
}

async function readBlobAtPath(path?: string): Promise<Blob | null> {
  if (!path) return null;
  const segments = path.split('/');
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
  return readBlobAtPath(screenshot?.path);
}

export async function readSnapshotScreenshotBlobs(screenshot?: SnapshotScreenshot): Promise<Blob[]> {
  if (!screenshot?.path) return [];
  const parts = screenshot.parts?.length ? screenshot.parts : [{ path: screenshot.path }];
  const blobs: Blob[] = [];
  for (const part of parts) {
    const blob = await readBlobAtPath(part.path);
    if (blob) blobs.push(blob);
  }
  return blobs;
}

type FileSystemDirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
};

type FileSystemDirectoryHandleWithRemove = FileSystemDirectoryHandle & {
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

async function clearDirectory(directory: FileSystemDirectoryHandle): Promise<void> {
  const entries = (directory as FileSystemDirectoryHandleWithEntries).entries;
  const removeEntry = (directory as FileSystemDirectoryHandleWithRemove).removeEntry;
  if (typeof entries !== 'function' || typeof removeEntry !== 'function') return;

  for await (const [name] of entries.call(directory as FileSystemDirectoryHandleWithEntries)) {
    await removeEntry.call(directory as FileSystemDirectoryHandleWithRemove, name, { recursive: true }).catch(() => undefined);
  }
}

async function listDirectoryFiles(
  directory: FileSystemDirectoryHandle,
  pathPrefix: string,
): Promise<Array<{ path: string; blob: Blob }>> {
  const entries = (directory as FileSystemDirectoryHandleWithEntries).entries;
  if (typeof entries !== 'function') return [];

  const files: Array<{ path: string; blob: Blob }> = [];
  for await (const [name, handle] of entries.call(directory as FileSystemDirectoryHandleWithEntries)) {
    const path = `${pathPrefix}/${name}`;
    if (handle.kind === 'directory') {
      files.push(...await listDirectoryFiles(handle, path));
    } else {
      files.push({ path, blob: await handle.getFile() });
    }
  }
  return files;
}

export async function readSnapshotOpfsFiles(snapshot: Snapshot): Promise<Array<{ path: string; blob: Blob }>> {
  const path = snapshotDirectoryPath(snapshot);
  try {
    const directory = await getDirectory(path.split('/'), false);
    return listDirectoryFiles(directory, path);
  } catch {
    return [];
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
