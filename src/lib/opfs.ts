import type { CaptureKind, Snapshot, SnapshotMhtml, SnapshotScreenshot, SnapshotScreenshotPart, SnapshotSingleFile } from './types';
import { capturePlugins } from './captureStatus';
import { t } from './i18n';

// Private to models.ts: every other module reads and writes capture files
// through models.ts, so the storage backend can be swapped in one place.

function pathSafeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

// ArchiveBox's Snapshot.extract_domain_from_url() (archivebox/core/models.py):
// the full hostname with an explicit port appended as _port, "localhost" for
// file: URLs, otherwise the scheme name. Parsed from the raw URL because
// `new URL()` drops explicit default ports (:443) that Python keeps.
function snapshotDomainSegment(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    const authority = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?/i.exec(url);
    const host = authority?.[1]?.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) return 'unknown';
    return pathSafeSegment(authority?.[2] ? `${host}_${Number(authority[2])}`.replaceAll(':', '_') : host);
  }
  if (scheme === 'file') return 'localhost';
  return scheme ? pathSafeSegment(scheme) : 'unknown';
}

// The server names snapshot folders str(uuid), which is dashed. Local ids are
// uuidv7() hex without dashes.
function snapshotIdSegment(id: string): string {
  const hex = id.toLowerCase().replaceAll('-', '');
  return /^[0-9a-f]{32}$/.test(hex)
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : pathSafeSegment(id);
}

// Django usernames allow letters, digits and @.+-_ (and are case-sensitive).
function usernameSegment(username?: string): string {
  const value = (username || 'system').replace(/[^A-Za-z0-9@.+_-]/g, '_');
  return value === '.' || value === '..' ? 'system' : value;
}

// Same layout as the server's archive directory (Snapshot.get_storage_path_for_version):
// users/{username}/snapshots/{YYYYMMDD of the UTC creation date}/{domain}/{uuid}/
// so a snapshot folder copies between the browser and the server unchanged.
// A folder never moves once written: capture records and upload receipts store
// these paths, and retention matches them against the server's copy.
export function snapshotDirectoryPath(snapshot: Snapshot): string {
  return [
    'users', usernameSegment(snapshot.created_by_username), 'snapshots',
    new Date(snapshot.timestamp).toISOString().slice(0, 10).replaceAll('-', ''),
    snapshotDomainSegment(snapshot.url),
    snapshotIdSegment(snapshot.id),
  ].join('/');
}

// Before 3.4 captures were written to snapshots/{local date}/{host without
// www. or port}/{id}/. Those files stay where they are (see above); this is
// only used to find and delete them.
function legacySnapshotDirectoryPath(snapshot: Snapshot): string {
  const date = new Date(snapshot.timestamp);
  let host = 'unknown';
  try { host = pathSafeSegment(new URL(snapshot.url).hostname); } catch { /* Invalid saved URL. */ }
  return ['snapshots',
    `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`,
    host, pathSafeSegment(snapshot.id)].join('/');
}

// Every folder that may hold this snapshot's files: the current layout, the
// legacy one, and the folders its stored capture paths point into.
function snapshotDirectoryPaths(snapshot: Snapshot): string[] {
  const stored = captureFilePaths(snapshot).flatMap(path => {
    const relative = snapshotRelativePath(snapshot, path);
    return relative ? [path.slice(0, path.length - relative.length - 1)] : [];
  });
  return [...new Set([snapshotDirectoryPath(snapshot), legacySnapshotDirectoryPath(snapshot), ...stored])];
}

function captureFilePaths(snapshot: Snapshot, kinds = Object.keys(capturePlugins) as CaptureKind[]): string[] {
  return kinds.flatMap(kind => {
    const capture = snapshot[kind];
    if (!capture) return [];
    return 'parts' in capture && capture.parts?.length ? capture.parts.map(part => part.path) : [capture.path];
  });
}

// A capture path relative to its snapshot folder ("{plugin}/{file}"), the
// form ArchiveResult.output_files uses on the server. Works for both layouts.
export function snapshotRelativePath(snapshot: Snapshot, path: string): string | null {
  const ids = new Set([snapshotIdSegment(snapshot.id), pathSafeSegment(snapshot.id)]);
  const segments = path.split('/');
  const index = segments.findIndex(segment => ids.has(segment.toLowerCase()));
  return index < 0 || index === segments.length - 1 ? null : segments.slice(index + 1).join('/');
}

function capturePath(snapshot: Snapshot, plugin: string, fileName: string): string {
  return `${snapshotDirectoryPath(snapshot)}/${plugin}/${fileName}`;
}

export function snapshotScreenshotPath(snapshot: Snapshot, partIndex = 0, viewport = false): string {
  return capturePath(snapshot, viewport ? capturePlugins.viewport_screenshot : capturePlugins.screenshot,
    partIndex === 0 ? 'screenshot.png' : `screenshot-${partIndex}.png`);
}

function snapshotMhtmlPath(snapshot: Snapshot): string {
  return capturePath(snapshot, capturePlugins.mhtml, 'snapshot.mhtml');
}

function snapshotSingleFilePath(snapshot: Snapshot): string {
  return capturePath(snapshot, capturePlugins.singlefile, 'singlefile.html');
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
  viewport = false,
): Promise<SnapshotScreenshot> {
  return writeSnapshotScreenshotParts(snapshot, [{ blob, x: 0, y: 0, width, height }], width, height, viewport);
}

export async function writeSnapshotScreenshotParts(
  snapshot: Snapshot,
  partBlobs: Array<{ blob: Blob; x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
  viewport = false,
): Promise<SnapshotScreenshot> {
  if (partBlobs.length === 0) throw new Error(t("No screenshot tiles were captured."));
  const firstPath = snapshotScreenshotPath(snapshot, 0, viewport);
  const firstSegments = firstPath.split('/');
  const firstFileName = firstSegments.pop();
  if (!firstFileName) throw new Error(t("Invalid local screenshot path."));

  const directory = await getDirectory(firstSegments, true);
  await clearDirectory(directory);
  const parts: SnapshotScreenshotPart[] = [];

  for (const [index, part] of partBlobs.entries()) {
    const path = snapshotScreenshotPath(snapshot, index, viewport);
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

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error(t("Full-page screenshot stitching is not available in this browser."));
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(t("Unable to prepare screenshot canvas.")));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return image;
}

async function canvasToPngBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }

  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(t("Unable to prepare screenshot canvas.")));
      }, 'image/png');
    });
  }

  throw new Error(t("Full-page screenshot stitching is not available in this browser."));
}

export async function composeSnapshotScreenshotBlob(screenshot?: SnapshotScreenshot): Promise<Blob | null> {
  if (!screenshot?.path) return null;

  const parts = screenshot.parts?.length
    ? screenshot.parts
    : [{
      path: screenshot.path,
      x: 0,
      y: 0,
      width: screenshot.width,
      height: screenshot.height,
    }];
  const blobs = await Promise.all(parts.map((part) => readBlobAtPath(part.path)));
  const available = parts
    .map((part, index) => ({ part, blob: blobs[index] }))
    .filter((item): item is { part: SnapshotScreenshotPart; blob: Blob } => Boolean(item.blob));

  if (!available.length) return null;
  const onlyAvailable = available[0];
  if (
    available.length === 1
    && onlyAvailable
    && onlyAvailable.part.x === 0
    && onlyAvailable.part.y === 0
    && onlyAvailable.part.width === screenshot.width
    && onlyAvailable.part.height === screenshot.height
  ) {
    return onlyAvailable.blob;
  }

  const width = Math.max(1, Math.floor(screenshot.width));
  const height = Math.max(1, Math.floor(screenshot.height));
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : (() => {
      if (typeof document === 'undefined') {
        throw new Error(t("Full-page screenshot stitching is not available in this browser."));
      }
      const element = document.createElement('canvas');
      element.width = width;
      element.height = height;
      return element;
    })();
  const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new Error(t("Unable to prepare screenshot canvas."));

  for (const { part, blob } of available) {
    const image = await blobToImageBitmap(blob);
    context.drawImage(image, part.x, part.y, part.width, part.height);
    if ('close' in image && typeof image.close === 'function') {
      image.close();
    }
  }

  return canvasToPngBlob(canvas);
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

async function getExistingDirectory(path: string): Promise<FileSystemDirectoryHandle | null> {
  let directory = await navigator.storage.getDirectory();
  for (const segment of path.split('/')) {
    try { directory = await directory.getDirectoryHandle(segment); } catch { return null; }
  }
  return directory;
}

export async function readSnapshotOpfsFiles(snapshot: Snapshot): Promise<Array<{ path: string; blob: Blob }>> {
  const files: Array<{ path: string; blob: Blob }> = [];
  for (const path of snapshotDirectoryPaths(snapshot)) {
    const directory = await getExistingDirectory(path);
    if (directory) files.push(...await listDirectoryFiles(directory, path));
  }
  return files;
}

export async function readSnapshotMhtmlBlob(mhtml?: SnapshotMhtml): Promise<Blob | null> {
  return readBlobAtPath(mhtml?.path);
}

export async function readSnapshotSingleFileBlob(singlefile?: SnapshotSingleFile): Promise<Blob | null> {
  return readBlobAtPath(singlefile?.path);
}

/** Delete a snapshot's capture folders (or only the given capture types), then any parent folders left empty. */
export async function deleteSnapshotOpfs(snapshot: Snapshot, kinds?: CaptureKind[]): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const isMissing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
  async function isEmpty(directory: FileSystemDirectoryHandle): Promise<boolean> {
    for await (const _ of (directory as FileSystemDirectoryHandleWithEntries).entries()) return false;
    return true;
  }
  // Removes path (a file or folder), then walks up removing folders it left empty.
  async function removePath(path: string): Promise<void> {
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Invalid capture path');
    const parents: FileSystemDirectoryHandle[] = [root];
    for (const segment of segments.slice(0, -1)) {
      try { parents.push(await parents.at(-1)!.getDirectoryHandle(segment)); } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
    }
    try { await parents.at(-1)!.removeEntry(segments.at(-1)!, { recursive: true }); } catch (error) {
      if (!isMissing(error)) throw error;
    }
    for (let index = segments.length - 2; index >= 0; index--) {
      if (!(await isEmpty(parents[index + 1]!))) break;
      await parents[index]!.removeEntry(segments[index]!);
    }
  }
  for (const directory of snapshotDirectoryPaths(snapshot)) {
    if (!kinds) { await removePath(directory); continue; }
    // chrome_mhtml is the plugin folder older versions wrote MHTML into.
    for (const plugin of [...kinds.map(kind => capturePlugins[kind]), ...(kinds.includes('mhtml') ? ['chrome_mhtml'] : [])]) {
      await removePath(`${directory}/${plugin}`);
    }
  }
  // Explicitly referenced files outside any snapshot folder (oldest layouts).
  for (const path of captureFilePaths(snapshot, kinds)) {
    if (!snapshotRelativePath(snapshot, path)) await removePath(path);
  }
}
