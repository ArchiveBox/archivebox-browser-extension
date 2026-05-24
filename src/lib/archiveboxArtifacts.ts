import {
  addFileToSnapshotArchiveResultChunked,
  uploadSnapshotArchiveResultFiles,
  type ArchiveResultOutputFile,
  type ArchiveResultUploadFile,
} from './archivebox';
import {
  readSnapshotOpfsFiles,
  snapshotDirectoryPath,
} from './screenshotStorage';
import type { Snapshot } from './types';

const extensionArtifactSource = 'archivebox-browser-extension';
const snapshotSyncLocks = new Map<string, Promise<{ opfs: boolean }>>();
const emptySyncResult = { opfs: false };

type SnapshotArtifactGroup = {
  plugin: string;
  outputStr: string;
  outputJson: Record<string, unknown>;
  files: ArchiveResultUploadFile[];
};

type OpfsFile = {
  path: string;
  directory: string;
  outputPath: string;
  blob: Blob;
};

function getOpfsFilesForSnapshot(snapshot: Snapshot, files: Array<{ path: string; blob: Blob }>): OpfsFile[] {
  const snapshotDirectory = `${snapshotDirectoryPath(snapshot)}/`;
  return files.flatMap((file) => {
    if (!file.path.startsWith(snapshotDirectory)) return [];
    const relativePath = file.path.slice(snapshotDirectory.length);
    const [directory, ...outputSegments] = relativePath.split('/');
    if (!directory || outputSegments.length === 0) return [];
    return [{
      path: file.path,
      directory,
      outputPath: outputSegments.join('/'),
      blob: file.blob,
    }];
  });
}

function opfsFileToUpload(file: OpfsFile): ArchiveResultUploadFile {
  return {
    blob: file.blob,
    outputPath: file.outputPath,
    mimeType: file.blob.type || 'application/octet-stream',
  };
}

function outputFileAlreadyUploaded(file: ArchiveResultUploadFile, outputFile?: ArchiveResultOutputFile): boolean {
  if (!outputFile) return false;
  if (Number(outputFile.size || 0) !== file.blob.size) return false;
  if (outputFile.upload && outputFile.upload.complete !== true) return false;
  return true;
}

function buildSnapshotArtifactGroups(snapshot: Snapshot, opfsFiles: OpfsFile[]): SnapshotArtifactGroup[] {
  const byDirectory = new Map<string, OpfsFile[]>();
  for (const file of opfsFiles) {
    byDirectory.set(file.directory, [...(byDirectory.get(file.directory) || []), file]);
  }

  return [...byDirectory.entries()].flatMap(([directory, files]) => {
    if (!files.length) return [];
    return [{
      plugin: directory,
      outputStr: files[0]?.outputPath || '',
      outputJson: {
        source: extensionArtifactSource,
        snapshot_title: snapshot.title,
        snapshot_url: snapshot.url,
        snapshot_tags: snapshot.tags,
        snapshot_depth: snapshot.depth ?? 0,
        opfs_directory: directory,
        opfs_file_count: files.length,
      },
      files: files.map(opfsFileToUpload),
    }];
  });
}

async function uploadSnapshotArtifactGroup(snapshot: Snapshot, group: SnapshotArtifactGroup): Promise<boolean> {
  if (!group.files.length) return false;

  const archiveResult = await uploadSnapshotArchiveResultFiles(snapshot.id, group.plugin, [], {
    outputStr: group.outputStr,
    outputJson: group.outputJson,
    status: 'started',
  });
  if (!archiveResult.id) return false;

  const filesToUpload = group.files.filter((file) => (
    !outputFileAlreadyUploaded(file, archiveResult.output_files?.[file.outputPath])
  ));
  if (!filesToUpload.length) return false;

  for (const [index, file] of filesToUpload.entries()) {
    await addFileToSnapshotArchiveResultChunked(archiveResult.id, file, {
      outputStr: group.outputStr,
      outputJson: group.outputJson,
      finalStatus: index + 1 === filesToUpload.length ? 'succeeded' : 'started',
    });
  }

  return true;
}

export async function uploadSnapshotCaptureArtifactsToArchiveBox(snapshot: Snapshot): Promise<{
  opfs: boolean;
}> {
  const previousSync = snapshotSyncLocks.get(snapshot.id) || Promise.resolve(emptySyncResult);
  const sync = previousSync
    .catch(() => emptySyncResult)
    .then(() => uploadSnapshotCaptureArtifactsToArchiveBoxUnlocked(snapshot))
    .finally(() => {
      if (snapshotSyncLocks.get(snapshot.id) === sync) {
        snapshotSyncLocks.delete(snapshot.id);
      }
    });
  snapshotSyncLocks.set(snapshot.id, sync);
  return sync;
}

async function uploadSnapshotCaptureArtifactsToArchiveBoxUnlocked(snapshot: Snapshot): Promise<{
  opfs: boolean;
}> {
  let uploadedAny = false;
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot));

  for (const group of buildSnapshotArtifactGroups(snapshot, opfsFiles)) {
    uploadedAny ||= await uploadSnapshotArtifactGroup(snapshot, group);
  }

  return {
    opfs: uploadedAny,
  };
}
