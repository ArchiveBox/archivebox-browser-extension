import { hasServerHostPermission, snapshotExistsOnServer } from './archivebox';
import { confirmedSnapshotCaptureKinds } from './archiveboxArtifacts';
import { capturePlugins } from './captureStatus';
import { getConfig } from './storage';
import { archiveResultDeleteAt, deleteSnapshotFiles, deleteSnapshots, forEachSnapshotDueForDeletion, getSnapshot, refreshDeleteAt, snapshotDeleteAt, updateSnapshot } from './models';
import type { CaptureKind, ConfigState, Snapshot, ServerConfiguration } from './types';

const alarmName = 'archivebox-local-retention';

// Shared with capture and upload operations across popup/options/background contexts.
export async function withSnapshotArtifacts<T>(snapshot_id: string, task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`archivebox-artifacts:${snapshot_id}`, task);
}

export async function cleanupExpiredSnapshots(): Promise<void> {
  await navigator.locks.request(alarmName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const config = await getConfig();
    await forEachSnapshotDueForDeletion(async (candidates) => {
      for (const candidate of candidates) await expireSnapshot(candidate, config);
    });
  });
}

async function expireSnapshot(candidate: Snapshot, config: ConfigState): Promise<void> {
  // delete_at is a schedule; recompute against the current settings and time.
  const now = Date.now();
  const due = (time: string | null) => time !== null && Date.parse(time) <= now;
  const destinations = Object.keys(candidate.remote_copies || {})
    .map((id) => config.servers.find((server) => server.id === id))
    .filter((server): server is ServerConfiguration => Boolean(server));
  const captures = (Object.keys(capturePlugins) as CaptureKind[]).filter(kind => candidate[kind]);
  const expired = captures.filter(kind => due(archiveResultDeleteAt(candidate, kind, config)));
  const removeRow = due(snapshotDeleteAt(candidate, config)) && captures.length === expired.length;
  if (!removeRow && !expired.length) return;
  if (!(await Promise.all(destinations.map((server) => hasServerHostPermission(server.server)))).every(Boolean)) return;
  await navigator.locks.request(`archivebox-delivery:${candidate.id}`, { ifAvailable: true }, async (submissionLock) => {
    if (!submissionLock) return;
    // Never interrupt a capture or upload. A later alarm will try again.
    await navigator.locks.request(`archivebox-artifacts:${candidate.id}`, { ifAvailable: true }, async (artifactLock) => {
      if (!artifactLock) return;
      // Only an authenticated, fresh, exact ID+URL match proves this local copy
      // is still backed by the configured server. No mutation is sent remotely.
      if (!(await Promise.all(destinations.map((server) => snapshotExistsOnServer(candidate, server)))).every(Boolean)) return;
      const confirmations = expired.length ? await Promise.all(destinations.map(server =>
        confirmedSnapshotCaptureKinds(server, candidate, expired).catch(() => [] as CaptureKind[]))) : [];
      const confirmed = expired.filter(kind => confirmations.every(kinds => kinds.includes(kind)));
      const deleteRow = removeRow && confirmed.length === captures.length;
      if (!deleteRow && !confirmed.length) return;
      // The checks above took network round trips: give up if the settings or
      // the snapshot changed meanwhile.
      const currentConfig = await getConfig();
      if (JSON.stringify(currentConfig.servers) !== JSON.stringify(config.servers)
        || currentConfig.local_retention_ms !== config.local_retention_ms
        || currentConfig.save_snapshots_locally !== config.save_snapshots_locally
        || JSON.stringify(currentConfig.capture_retention_ms) !== JSON.stringify(config.capture_retention_ms)) return;
      if (JSON.stringify(await getSnapshot(candidate.id)) !== JSON.stringify(candidate)) return;
      // Remove bytes first. Failures leave the record available for retry.
      await deleteSnapshotFiles(candidate, deleteRow ? undefined : confirmed);
      if (deleteRow) {
        await deleteSnapshots([candidate.id]);
        return;
      }
      await updateSnapshot(candidate.id, (snapshot) => {
        const next = { ...snapshot };
        for (const kind of confirmed) delete next[kind];
        return next;
      });
    });
  });
}

export function configureLocalRetention(): void {
  const run = () => cleanupExpiredSnapshots().catch(() => {
    // Do not put snapshot URLs, titles, credentials, or IDs in persistent logs.
    console.warn('ArchiveBox: local retention check could not finish; local records were retained.');
  });
  const schedule = async () => {
    if (!(await browser.alarms.get(alarmName))) {
      await browser.alarms.create(alarmName, { periodInMinutes: 1 });
    }
    await run();
  };
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) void run();
  });
  browser.runtime.onStartup.addListener(() => { void schedule(); });
  browser.runtime.onInstalled.addListener(() => { void schedule(); });
  browser.storage.onChanged.addListener((changes, area) => {
    // These settings change every delete_at; reschedule, then check.
    if (area === 'local' && ['save_snapshots_locally', 'local_retention_ms', 'capture_retention_ms', 'server_registry'].some((key) => key in changes)) {
      void refreshDeleteAt().then(run, run);
    }
  });
  void schedule();
}
