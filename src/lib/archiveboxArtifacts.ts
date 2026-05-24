import {
  addFileToSnapshotArchiveResultChunked,
  uploadSnapshotArchiveResultFiles,
  type ArchiveResultUploadFile,
} from './archivebox';
import { renderMhtmlToHtml } from './mhtml';
import {
  composeSnapshotScreenshotBlob,
  readSnapshotMhtmlBlob,
  readSnapshotOpfsFiles,
  snapshotDirectoryPath,
} from './screenshotStorage';
import type { Snapshot } from './types';

const extensionArtifactSource = 'archivebox-browser-extension';
const metadataOutputPath = '_archivebox_extension_metadata.json';

type SnapshotArtifactKind = 'screenshot' | 'mhtml' | 'singlefile';

type SnapshotArtifactGroup = {
  kind: SnapshotArtifactKind | 'opfs';
  plugin: string;
  outputStr: string;
  outputJson: Record<string, unknown>;
  createFiles: ArchiveResultUploadFile[];
  opfsFiles: ArchiveResultUploadFile[];
};

type OpfsFile = {
  path: string;
  directory: string;
  outputPath: string;
  blob: Blob;
};

function extensionForPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() || '';
}

function mimeTypeForPath(path: string, blob: Blob, fallback = 'application/octet-stream'): string {
  if (blob.type) return blob.type;
  switch (extensionForPath(path)) {
    case 'html':
    case 'htm':
      return 'text/html';
    case 'json':
      return 'application/json';
    case 'mhtml':
    case 'mht':
      return 'multipart/related';
    case 'png':
      return 'image/png';
    default:
      return fallback;
  }
}

function sanitizeArchiveResultPlugin(value: string): string {
  return value.replace(/^chrome_extension_/, '').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 32) || 'opfs';
}

function pluginForOpfsDirectory(directory: string): SnapshotArtifactGroup['plugin'] {
  switch (directory) {
    case 'chrome_extension_screenshot':
      return 'screenshot';
    case 'chrome_extension_mhtml':
      return 'dom';
    case 'chrome_extension_singlefile':
      return 'singlefile';
    default:
      return sanitizeArchiveResultPlugin(directory);
  }
}

function kindForOpfsDirectory(directory: string): SnapshotArtifactGroup['kind'] {
  switch (directory) {
    case 'chrome_extension_screenshot':
      return 'screenshot';
    case 'chrome_extension_mhtml':
      return 'mhtml';
    case 'chrome_extension_singlefile':
      return 'singlefile';
    default:
      return 'opfs';
  }
}

function snapshotBaseOutputJson(snapshot: Snapshot, kind: SnapshotArtifactGroup['kind']) {
  return {
    source: extensionArtifactSource,
    artifact_kind: kind,
    snapshot_title: snapshot.title,
    snapshot_url: snapshot.url,
    snapshot_tags: snapshot.tags,
    snapshot_depth: snapshot.depth ?? 0,
  };
}

function metadataBlob(group: SnapshotArtifactGroup): Blob {
  return new Blob([JSON.stringify({
    ...group.outputJson,
    generated_files: group.createFiles.map((file) => ({
      output_path: file.outputPath,
      size: file.blob.size,
      mimetype: file.mimeType || file.blob.type || 'application/octet-stream',
    })),
    opfs_files: group.opfsFiles.map((file) => ({
      output_path: file.outputPath,
      size: file.blob.size,
      mimetype: file.mimeType || file.blob.type || 'application/octet-stream',
    })),
  }, null, 2)], { type: 'application/json' });
}

function getOpfsFilesForSnapshot(snapshot: Snapshot, files: Array<{ path: string; blob: Blob }>): OpfsFile[] {
  const snapshotDirectory = `${snapshotDirectoryPath(snapshot)}/`;
  return files.flatMap((file) => {
    if (!file.path.startsWith(snapshotDirectory)) return [];
    const relativePath = file.path.slice(snapshotDirectory.length);
    const [directory, ...outputSegments] = relativePath.split('/');
    if (!directory || outputSegments.length === 0) return [];
    const outputPath = outputSegments.join('/');
    return [{
      path: file.path,
      directory,
      outputPath,
      blob: file.blob,
    }];
  });
}

function opfsFileToUpload(file: OpfsFile, outputPath = file.outputPath): ArchiveResultUploadFile {
  return {
    blob: file.blob,
    outputPath,
    mimeType: mimeTypeForPath(outputPath, file.blob),
  };
}

async function buildScreenshotGroup(snapshot: Snapshot, opfsFiles: OpfsFile[]): Promise<SnapshotArtifactGroup | null> {
  const screenshotBlob = await composeSnapshotScreenshotBlob(snapshot.screenshot);
  if (!screenshotBlob && !opfsFiles.length) return null;

  const hasMultipleParts = (snapshot.screenshot?.parts?.length || 0) > 1;
  const createFiles: ArchiveResultUploadFile[] = screenshotBlob
    ? [{
      blob: screenshotBlob,
      outputPath: 'screenshot.png',
      mimeType: 'image/png',
    }]
    : [];
  const rawFiles = opfsFiles
    .filter((file) => hasMultipleParts || file.outputPath !== 'screenshot.png' || !screenshotBlob)
    .map((file) => opfsFileToUpload(file, hasMultipleParts ? `opfs/${file.outputPath}` : file.outputPath));
  const outputJson = {
    ...snapshotBaseOutputJson(snapshot, 'screenshot'),
    captured_at: snapshot.screenshot?.capturedAt,
    width: snapshot.screenshot?.width,
    height: snapshot.screenshot?.height,
    parts: snapshot.screenshot?.parts?.length || opfsFiles.length || 1,
    opfs_directory: 'chrome_extension_screenshot',
  };

  return {
    kind: 'screenshot',
    plugin: 'screenshot',
    outputStr: 'screenshot.png',
    outputJson,
    createFiles,
    opfsFiles: rawFiles,
  };
}

async function buildMhtmlGroup(snapshot: Snapshot, opfsFiles: OpfsFile[]): Promise<SnapshotArtifactGroup | null> {
  const mhtmlBlob = await readSnapshotMhtmlBlob(snapshot.mhtml);
  if (!mhtmlBlob && !opfsFiles.length) return null;

  const createFiles: ArchiveResultUploadFile[] = [];
  const outputJson: Record<string, unknown> = {
    ...snapshotBaseOutputJson(snapshot, 'mhtml'),
    source_mime_type: snapshot.mhtml?.mimeType || 'multipart/related',
    captured_at: snapshot.mhtml?.capturedAt,
    mhtml_size: snapshot.mhtml?.size ?? mhtmlBlob?.size,
    raw_mhtml_uploaded: Boolean(mhtmlBlob || opfsFiles.length),
    raw_mhtml_upload_strategy: 'chunked',
    opfs_directory: 'chrome_extension_mhtml',
  };

  if (mhtmlBlob) {
    try {
      const rawMhtml = await mhtmlBlob.text();
      const rendered = renderMhtmlToHtml(rawMhtml, snapshot.url);
      createFiles.push({
        blob: new Blob([rendered.html], { type: 'text/html;charset=utf-8' }),
        outputPath: 'output.html',
        mimeType: 'text/html',
      });
      outputJson.mhtml_part_count = rendered.partCount;
      outputJson.title = rendered.title;
    } catch (error) {
      outputJson.render_error = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    kind: 'mhtml',
    plugin: 'dom',
    outputStr: createFiles.length ? 'output.html' : 'snapshot.mhtml',
    outputJson,
    createFiles,
    opfsFiles: opfsFiles.map((file) => opfsFileToUpload(file)),
  };
}

function buildSingleFileGroup(snapshot: Snapshot, opfsFiles: OpfsFile[]): SnapshotArtifactGroup | null {
  if (!opfsFiles.length) return null;

  return {
    kind: 'singlefile',
    plugin: 'singlefile',
    outputStr: 'singlefile.html',
    outputJson: {
      ...snapshotBaseOutputJson(snapshot, 'singlefile'),
      captured_at: snapshot.singlefile?.capturedAt,
      size: snapshot.singlefile?.size,
      filename: snapshot.singlefile?.filename,
      opfs_directory: 'chrome_extension_singlefile',
    },
    createFiles: [],
    opfsFiles: opfsFiles.map((file) => opfsFileToUpload(file)),
  };
}

function buildGenericOpfsGroup(snapshot: Snapshot, directory: string, opfsFiles: OpfsFile[]): SnapshotArtifactGroup | null {
  if (!opfsFiles.length) return null;
  const firstFile = opfsFiles[0];
  const plugin = pluginForOpfsDirectory(directory);

  return {
    kind: kindForOpfsDirectory(directory),
    plugin,
    outputStr: firstFile?.outputPath || metadataOutputPath,
    outputJson: {
      ...snapshotBaseOutputJson(snapshot, kindForOpfsDirectory(directory)),
      opfs_directory: directory,
    },
    createFiles: [],
    opfsFiles: opfsFiles.map((file) => opfsFileToUpload(file)),
  };
}

async function buildSnapshotArtifactGroups(snapshot: Snapshot): Promise<SnapshotArtifactGroup[]> {
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot));
  const byDirectory = new Map<string, OpfsFile[]>();
  for (const file of opfsFiles) {
    byDirectory.set(file.directory, [...(byDirectory.get(file.directory) || []), file]);
  }

  const groups: Array<SnapshotArtifactGroup | null> = [
    await buildScreenshotGroup(snapshot, byDirectory.get('chrome_extension_screenshot') || []),
    await buildMhtmlGroup(snapshot, byDirectory.get('chrome_extension_mhtml') || []),
    buildSingleFileGroup(snapshot, byDirectory.get('chrome_extension_singlefile') || []),
  ];
  byDirectory.delete('chrome_extension_screenshot');
  byDirectory.delete('chrome_extension_mhtml');
  byDirectory.delete('chrome_extension_singlefile');

  for (const [directory, files] of byDirectory.entries()) {
    groups.push(buildGenericOpfsGroup(snapshot, directory, files));
  }

  return groups.filter((group): group is SnapshotArtifactGroup => Boolean(group));
}

async function uploadSnapshotArtifactGroup(snapshot: Snapshot, group: SnapshotArtifactGroup): Promise<boolean> {
  const filesToUpload = [...group.createFiles, ...group.opfsFiles];
  const archiveResult = await uploadSnapshotArchiveResultFiles(snapshot.id, group.plugin, [{
    blob: metadataBlob(group),
    outputPath: metadataOutputPath,
    mimeType: 'application/json',
  }], {
    outputStr: group.outputStr,
    outputJson: group.outputJson,
    status: filesToUpload.length ? 'started' : 'succeeded',
  });
  if (!archiveResult.id) return filesToUpload.length === 0;

  for (const [index, file] of filesToUpload.entries()) {
    await addFileToSnapshotArchiveResultChunked(archiveResult.id, file, {
      outputStr: group.outputStr,
      outputJson: group.outputJson,
      finalStatus: index + 1 === filesToUpload.length ? 'succeeded' : 'started',
    });
  }

  return true;
}

export async function uploadSnapshotScreenshotToArchiveBox(snapshot: Snapshot): Promise<boolean> {
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot))
    .filter((file) => file.directory === 'chrome_extension_screenshot');
  const group = await buildScreenshotGroup(snapshot, opfsFiles);
  return group ? uploadSnapshotArtifactGroup(snapshot, group) : false;
}

export async function uploadSnapshotMhtmlToArchiveBox(snapshot: Snapshot): Promise<boolean> {
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot))
    .filter((file) => file.directory === 'chrome_extension_mhtml');
  const group = await buildMhtmlGroup(snapshot, opfsFiles);
  return group ? uploadSnapshotArtifactGroup(snapshot, group) : false;
}

export async function uploadSnapshotSingleFileToArchiveBox(snapshot: Snapshot): Promise<boolean> {
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot))
    .filter((file) => file.directory === 'chrome_extension_singlefile');
  const group = buildSingleFileGroup(snapshot, opfsFiles);
  return group ? uploadSnapshotArtifactGroup(snapshot, group) : false;
}

export async function uploadSnapshotCaptureArtifactsToArchiveBox(snapshot: Snapshot): Promise<{
  screenshot: boolean;
  mhtml: boolean;
  singlefile: boolean;
  opfs: boolean;
}> {
  const result = {
    screenshot: false,
    mhtml: false,
    singlefile: false,
    opfs: false,
  };

  for (const group of await buildSnapshotArtifactGroups(snapshot)) {
    const uploaded = await uploadSnapshotArtifactGroup(snapshot, group);
    if (group.kind === 'screenshot') result.screenshot ||= uploaded;
    else if (group.kind === 'mhtml') result.mhtml ||= uploaded;
    else if (group.kind === 'singlefile') result.singlefile ||= uploaded;
    else result.opfs ||= uploaded;
  }

  return result;
}
