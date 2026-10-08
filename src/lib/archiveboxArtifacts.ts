import { withSnapshotArtifacts } from './retention';
import {
  addFilesToSnapshotArchiveResult,
  addFileToSnapshotArchiveResultChunked,
  archiveResultUploadChunkSize,
  uploadSnapshotArchiveResultFiles,
  hasServerHostPermission,
  fetchWithTimeout,
  type ArchiveResultOutputFile,
  type ArchiveResultUploadFile,
} from './archivebox';
import {
  readSnapshotOpfsFiles,
} from './screenshotStorage';
import type { ArtifactDelivery, CaptureKind, Snapshot, ServerConfiguration, ServerDestination } from './types';
import { capturePlugins } from './captureStatus';
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
    // A recapture can leave older directories behind. Receipts must describe
    // the active capture's files, not another version with the same filename.
    const plugin = file.directory === 'chrome_mhtml' ? 'chrome_extension_mhtml' : file.directory;
    const kind = (Object.keys(capturePlugins) as CaptureKind[]).find(kind => capturePlugins[kind] === plugin);
    if (kind) {
      const capture = snapshot[kind];
      const paths = capture && 'parts' in capture && capture.parts?.length ? capture.parts.map(part => part.path) : [capture?.path];
      if (!paths.includes(file.path)) continue;
    }
    byDirectory.set(file.directory, [...(byDirectory.get(file.directory) || []), file]);
  }

  return [...byDirectory.entries()].flatMap(([directory, files]) => {
    if (!files.length) return [];
    const plugin = directory === 'chrome_mhtml' ? 'chrome_extension_mhtml' : directory;
    const kind = (Object.keys(capturePlugins) as CaptureKind[]).find(kind => capturePlugins[kind] === plugin);
    const capture = kind ? snapshot[kind] : undefined;
    return [{
      // Never share the server hook's chrome_mhtml directory: its later capture would overwrite ours.
      plugin,
      output_str: files[0]?.output_path || '',
      output_json: {
        source: extensionArtifactSource,
        snapshot_title: snapshot.title,
        snapshot_url: snapshot.url,
        snapshot_tags: snapshot.tags,
        snapshot_depth: snapshot.depth ?? 0,
        opfs_directory: directory,
        opfs_file_count: files.length,
        ...(capture ? { capture: { path: capture.path, captured_at: capture.capturedAt } } : {}),
      },
      files: files.map(opfsFileToUpload),
    }];
  });
}

// Older versions saved a URL receipt but no per-file receipts. Recover what the
// server actually confirms, without inferring uploads from local capture files
// or today's upload preferences. Failure leaves the old state unverified.
async function readSnapshotArtifactResults(server: ServerConfiguration, snapshot: Snapshot) {
  const copy = snapshot.remote_copies?.[server.id];
  if (!copy?.snapshot_id || copy.submitted_to !== server.server || !(await hasServerHostPermission(server.server))) throw new Error('Snapshot destination is unavailable.');
  const response = await fetchWithTimeout(`${server.server}/api/v1/core/snapshot/${encodeURIComponent(copy.snapshot_id)}`, {
    headers: server.token ? { Authorization: `Bearer ${server.token}` } : {},
    credentials: 'include', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const remote = await response.json() as { id?: string; url?: string; archiveresults?: Array<{
    id: string; plugin: string; status: string; end_ts?: string;
    output_json?: { source?: string; capture?: { path?: string; captured_at?: string } };
    output_files?: Record<string, ArchiveResultOutputFile>;
  }> };
  if (remote.id?.replaceAll('-', '') !== copy.snapshot_id.replaceAll('-', '') || remote.url !== snapshot.url || !Array.isArray(remote.archiveresults)) {
    throw new Error('Server did not confirm the snapshot artifacts.');
  }
  return remote.archiveresults;
}

export async function refreshSnapshotArtifactReceipts(server: ServerDestination, snapshot: Snapshot): Promise<void> {
  const copy = snapshot.remote_copies?.[server.id];
  if (!copy?.snapshot_id || copy.artifacts !== undefined) return;
  const results = await readSnapshotArtifactResults(server, snapshot);
  const artifacts: Partial<Record<CaptureKind, ArtifactDelivery>> = {};
  for (const result of results) {
    const plugin = result.plugin === 'chrome_mhtml' ? 'chrome_extension_mhtml' : result.plugin;
    const kind = (Object.keys(capturePlugins) as CaptureKind[]).find(kind => capturePlugins[kind] === plugin);
    const files = Object.values(result.output_files || {});
    if (!kind || result.output_json?.source !== extensionArtifactSource || result.status !== 'succeeded'
      || !files.length || !files.every(file => Number(file.size) > 0 && (!file.upload || file.upload.complete === true))) continue;
    artifacts[kind] = { status: 'uploaded', archive_result_id: result.id, uploaded_at: result.end_ts,
      path: result.output_json.capture?.path, captured_at: result.output_json.capture?.captured_at };
  }
  await mutateSnapshots(entries => entries.map(item => {
    const latest = item.remote_copies?.[server.id];
    if (item.id !== snapshot.id || !latest || latest.snapshot_id !== copy.snapshot_id || latest.crawl_id !== copy.crawl_id || latest.artifacts !== undefined) return item;
    return { ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...latest, artifacts } } };
  }));
}

// Retention requires fresh evidence of the exact uploaded version, not merely
// a URL receipt or a server-generated screenshot of the same page.
export async function confirmedSnapshotCaptureKinds(server: ServerConfiguration, snapshot: Snapshot, kinds: CaptureKind[]): Promise<CaptureKind[]> {
  const results = await readSnapshotArtifactResults(server, snapshot);
  return kinds.filter(kind => {
    const capture = snapshot[kind];
    const receipt = snapshot.remote_copies?.[server.id]?.artifacts?.[kind];
    if (!capture || receipt?.status !== 'uploaded' || receipt.path !== capture.path || receipt.captured_at !== capture.capturedAt) return false;
    const result = results.find(result => result.id === receipt.archive_result_id);
    if (!result || result.status !== 'succeeded' || result.plugin !== capturePlugins[kind]
      || result.output_json?.source !== extensionArtifactSource || result.output_json.capture?.path !== capture.path
      || result.output_json.capture?.captured_at !== capture.capturedAt) return false;
    const paths = 'parts' in capture && capture.parts?.length ? capture.parts.map(part => part.path) : [capture.path];
    return paths.every(path => {
      const segments = path.split('/');
      const id = segments.findIndex(segment => segment.toLowerCase() === snapshot.id.toLowerCase());
      if (id < 0) return false;
      const file = result.output_files?.[segments.slice(id + 2).join('/')];
      return file && Number(file.size) > 0 && (!file.upload || file.upload.complete === true);
    });
  });
}

async function uploadSnapshotArtifactGroup(server: ServerDestination, group: SnapshotArtifactGroup, snapshot_id: string, previous?: ArtifactDelivery): Promise<{ uploaded: boolean; id: string }> {
  const archiveResult = await uploadSnapshotArchiveResultFiles(server, snapshot_id, group.plugin, [], {
    output_str: group.output_str,
    output_json: group.output_json,
    status: 'started',
  });
  if (!archiveResult.id) throw new Error('Server did not confirm the artifact upload.');

  // Equal size alone does not prove that a recapture has been uploaded.
  // Reuse only a receipt for this capture version AND the confirmed remote files.
  const filesToUpload = group.files.filter(file => !(previous?.status === 'uploaded'
    && previous.archive_result_id === archiveResult.id
    && archiveResult.status === 'succeeded'
    && outputFileAlreadyUploaded(file, archiveResult.output_files?.[file.output_path])));
  if (!filesToUpload.length) return { uploaded: false, id: archiveResult.id };

  const directFiles = filesToUpload.filter((file) => file.blob.size <= archiveResultUploadChunkSize);
  const chunkedFiles = filesToUpload.filter((file) => file.blob.size > archiveResultUploadChunkSize);
  let confirmation = archiveResult;

  if (directFiles.length) {
    confirmation = await addFilesToSnapshotArchiveResult(server, archiveResult.id, directFiles, {
      output_str: group.output_str,
      output_json: group.output_json,
      status: chunkedFiles.length ? 'started' : 'succeeded',
    });
  }

  for (const [index, file] of chunkedFiles.entries()) {
    confirmation = await addFileToSnapshotArchiveResultChunked(server, archiveResult.id, file, {
      output_str: group.output_str,
      output_json: group.output_json,
      finalStatus: index + 1 === chunkedFiles.length ? 'succeeded' : 'started',
    });
  }

  if (confirmation.id !== archiveResult.id || confirmation.status !== 'succeeded'
    || !group.files.every(file => outputFileAlreadyUploaded(file, confirmation.output_files?.[file.output_path]))) {
    throw new Error('Server did not confirm the complete artifact upload.');
  }

  return { uploaded: true, id: archiveResult.id };
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
          return { ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...latest, status,
            delivery_error: status === 'complete' ? undefined : latest.delivery_error,
          } } };
        }));
      };
      await setStatus('accepted');
      try {
        const result = await uploadSnapshotCaptureArtifactsToArchiveBoxUnlocked(server, current, snapshot_id);
        await setStatus('complete');
        return result;
      } catch (error) {
        await mutateSnapshots(entries => entries.map(item => {
          const latest = item.remote_copies?.[server.id];
          if (item.id !== current.id || latest?.snapshot_id !== snapshot_id || latest.crawl_id !== copy?.crawl_id) return item;
          return { ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...latest,
            status: 'accepted', delivery_error: error instanceof Error ? error.message : String(error),
          } } };
        }));
        throw error;
      }
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
    if (group.plugin === 'chrome_extension_viewport' && !server.policy.upload_viewport_screenshots_to_server) continue;
    if (group.plugin === 'chrome_extension_screenshot' && !server.policy.upload_screenshots_to_server) continue;
    if (group.plugin === 'chrome_extension_mhtml' && !server.policy.upload_mhtml_to_server) continue;
    if (group.plugin === 'chrome_extension_singlefile' && !server.policy.upload_singlefile_to_server) continue;
    const kind = (Object.keys(capturePlugins) as CaptureKind[]).find(kind => capturePlugins[kind] === group.plugin);
    const capture = kind ? snapshot[kind] : undefined;
    const copy = snapshot.remote_copies?.[server.id];
    const previous = kind ? copy?.artifacts?.[kind] : undefined;
    const matchingReceipt = capture && previous?.path === capture.path && previous.captured_at === capture.capturedAt ? previous : undefined;
    const saveReceipt = async (receipt: ArtifactDelivery) => {
      if (!kind || !capture) return;
      await mutateSnapshots(entries => entries.map(item => {
        const latest = item.remote_copies?.[server.id];
        if (item.id !== snapshot.id || latest?.snapshot_id !== snapshot_id || latest.crawl_id !== copy?.crawl_id) return item;
        return { ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...latest,
          artifacts: { ...latest.artifacts, [kind]: { ...receipt, path: capture.path, captured_at: capture.capturedAt } },
        } } };
      }));
    };
    try {
      const result = await uploadSnapshotArtifactGroup(server, group, snapshot_id, matchingReceipt);
      uploadedAny = uploadedAny || result.uploaded;
      await saveReceipt({ status: 'uploaded', archive_result_id: result.id,
        uploaded_at: !result.uploaded && matchingReceipt?.uploaded_at ? matchingReceipt.uploaded_at : new Date().toISOString() });
    } catch (error) {
      // A failed retry must not erase proof that these exact bytes were sent.
      if (matchingReceipt?.status !== 'uploaded') await saveReceipt({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  return {
    opfs: uploadedAny,
  };
}
