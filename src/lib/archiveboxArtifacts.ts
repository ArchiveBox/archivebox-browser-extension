import { withSnapshotArtifacts } from './retention';
import {
  addFilesToSnapshotArchiveResult,
  addFileToSnapshotArchiveResultChunked,
  archiveResultUploadChunkSize,
  uploadSnapshotArchiveResultFiles,
  type ArchiveResultOutputFile,
  type ArchiveResultUploadFile,
} from './archivebox';
import {
  readSnapshotOpfsFiles,
} from './screenshotStorage';
import type { Snapshot, ServerDestination } from './types';
import { getSnapshots, mutateSnapshots } from './storage';

const extensionArtifactSource = 'archivebox-browser-extension';
const snapshotSyncLocks = new Map<string, Promise<{ opfs: boolean }>>();
const emptySyncResult = { opfs: false };

type SnapshotArtifactGroup = {
  plugin: string;
  output_str: string;
  output_json: Record<string, unknown>;
  files: ArchiveResultUploadFile[];
};

type OpfsFile = {
  path: string;
  directory: string;
  output_path: string;
  blob: Blob;
};

function getOpfsFilesForSnapshot(snapshot: Snapshot, files: Array<{ path: string; blob: Blob }>): OpfsFile[] {
  const snapshotIdSegment = snapshot.id.toLowerCase();
  return files.flatMap((file) => {
    const segments = file.path.split('/');
    const snapshotIdIndex = segments.findIndex((segment) => segment.toLowerCase() === snapshotIdSegment);
    if (snapshotIdIndex < 0) return [];
    const [directory, ...outputSegments] = segments.slice(snapshotIdIndex + 1);
    if (!directory || outputSegments.length === 0) return [];
    return [{
      path: file.path,
      directory,
      output_path: outputSegments.join('/'),
      blob: file.blob,
    }];
  });
}

function opfsFileToUpload(file: OpfsFile): ArchiveResultUploadFile {
  return {
    blob: file.blob,
    output_path: file.output_path,
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
      output_str: files[0]?.output_path || '',
      output_json: {
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

async function uploadSnapshotArtifactGroup(server: ServerDestination, snapshot: Snapshot, group: SnapshotArtifactGroup, snapshot_id: string): Promise<boolean> {
  if (!group.files.length) return false;

  const archiveResult = await uploadSnapshotArchiveResultFiles(server, snapshot_id, group.plugin, [], {
    output_str: group.output_str,
    output_json: group.output_json,
    status: 'started',
  });
  if (!archiveResult.id) throw new Error('Server did not confirm the artifact upload.');

  const filesToUpload = group.files.filter((file) => (
    !outputFileAlreadyUploaded(file, archiveResult.output_files?.[file.output_path])
  ));
  if (!filesToUpload.length) return false;

  const directFiles = filesToUpload.filter((file) => file.blob.size <= archiveResultUploadChunkSize);
  const chunkedFiles = filesToUpload.filter((file) => file.blob.size > archiveResultUploadChunkSize);

  if (directFiles.length) {
    await addFilesToSnapshotArchiveResult(server, archiveResult.id, directFiles, {
      output_str: group.output_str,
      output_json: group.output_json,
      status: chunkedFiles.length ? 'started' : 'succeeded',
    });
  }

  for (const [index, file] of chunkedFiles.entries()) {
    await addFileToSnapshotArchiveResultChunked(server, archiveResult.id, file, {
      output_str: group.output_str,
      output_json: group.output_json,
      finalStatus: index + 1 === chunkedFiles.length ? 'succeeded' : 'started',
    });
  }

  return true;
}

export async function uploadSnapshotCaptureArtifactsToArchiveBox(server: ServerDestination, snapshot: Snapshot, snapshot_id = snapshot.remote_copies?.[server.id]?.snapshot_id): Promise<{
  opfs: boolean;
}> {
  const previousSync = snapshotSyncLocks.get(`${server.id}:${snapshot.id}`) || Promise.resolve(emptySyncResult);
  const sync = previousSync
    .catch(() => emptySyncResult)
    .then(() => withSnapshotArtifacts(snapshot.id, async () => {
      const current = (await getSnapshots()).find((item) => item.id === snapshot.id);
      if (!current || !snapshot_id) return emptySyncResult;
      const copy = current.remote_copies?.[server.id];
      const setStatus = async (status: 'accepted' | 'complete') => {
        await mutateSnapshots((entries) => entries.map((item) => {
          const latest = item.remote_copies?.[server.id];
          if (item.id !== current.id || !latest || latest.snapshot_id !== snapshot_id || latest.crawl_id !== copy?.crawl_id) return item;
          return { ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...latest, status } } };
        }));
      };
      await setStatus('accepted');
      const result = await uploadSnapshotCaptureArtifactsToArchiveBoxUnlocked(server, current, snapshot_id);
      await setStatus('complete');
      return result;
    }))
    .finally(() => {
      if (snapshotSyncLocks.get(`${server.id}:${snapshot.id}`) === sync) {
        snapshotSyncLocks.delete(`${server.id}:${snapshot.id}`);
      }
    });
  snapshotSyncLocks.set(`${server.id}:${snapshot.id}`, sync);
  return sync;
}

async function uploadSnapshotCaptureArtifactsToArchiveBoxUnlocked(server: ServerDestination, snapshot: Snapshot, snapshot_id?: string): Promise<{
  opfs: boolean;
}> {
  let uploadedAny = false;
  if (!snapshot_id) return emptySyncResult;
  const opfsFiles = getOpfsFilesForSnapshot(snapshot, await readSnapshotOpfsFiles(snapshot));

  for (const group of buildSnapshotArtifactGroups(snapshot, opfsFiles)) {
    if (group.plugin === 'chrome_extension_screenshot' && !server.policy.upload_screenshots_to_server) continue;
    if (group.plugin === 'chrome_mhtml' && !server.policy.upload_mhtml_to_server) continue;
    if (group.plugin === 'chrome_extension_singlefile' && !server.policy.upload_singlefile_to_server) continue;
    const groupUploaded = await uploadSnapshotArtifactGroup(server, snapshot, group, snapshot_id);
    uploadedAny = uploadedAny || groupUploaded;
  }

  return {
    opfs: uploadedAny,
  };
}
