import { hasServerHostPermission, snapshotExistsOnServer } from './archivebox';
import { deleteSnapshotOpfs } from './screenshotStorage';
import { confirmedSnapshotCaptureKinds } from './archiveboxArtifacts';
import { capturePlugins } from './captureStatus';
import { getConfig, getSnapshots, mutateSnapshots } from './storage';
import type { CaptureKind, ConfigState, Snapshot, ServerConfiguration } from './types';

const alarmName = 'archivebox-local-retention';

function isExpired(snapshot: Snapshot, config: ConfigState, server: ServerConfiguration): boolean {
  const ttl = config.save_snapshots_locally ? config.local_retention_ms : 0;
  if (ttl === 'never' || snapshot.remote_copies?.[server.id]?.status !== 'complete') return false;
  const copy = snapshot.remote_copies?.[server.id];
  const submitted = Math.max(Date.parse(copy?.submitted_at || ''), ...Object.values(copy?.artifacts || {}).map(receipt => Date.parse(receipt.uploaded_at || '')).filter(Number.isFinite));
  return Number.isFinite(submitted)
    && snapshot.remote_copies?.[server.id]?.submitted_to === new URL(server.server).toString().replace(/\/$/, '')
    && Date.now() - submitted >= ttl;
}

function captureExpired(snapshot: Snapshot, kind: CaptureKind, config: ConfigState, servers: ServerConfiguration[]): boolean {
  const capture = snapshot[kind];
  let ttl: number | 'never' = config.capture_retention_ms[kind] ?? config.local_retention_ms;
  if (config.local_retention_ms !== 'never' && (ttl === 'never' || ttl > config.local_retention_ms)) ttl = config.local_retention_ms;
  if (!config.save_snapshots_locally) ttl = 0;
  if (!capture || ttl === 'never' || !servers.length) return false;
  return servers.every(server => {
    const copy = snapshot.remote_copies?.[server.id];
    const receipt = copy?.artifacts?.[kind];
    const uploaded = Date.parse(receipt?.uploaded_at || '');
    return copy?.submitted_to === server.server && receipt?.status === 'uploaded'
      && receipt.path === capture.path && receipt.captured_at === capture.capturedAt
      && Number.isFinite(uploaded) && Date.now() - uploaded >= ttl;
  });
}

// Shared with capture and upload operations across popup/options/background contexts.
export async function withSnapshotArtifacts<T>(snapshot_id: string, task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`archivebox-artifacts:${snapshot_id}`, task);
}

export async function cleanupExpiredSnapshots(): Promise<void> {
  await navigator.locks.request(alarmName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const config = await getConfig();
    if (config.save_snapshots_locally && config.local_retention_ms === 'never' && Object.values(config.capture_retention_ms).every(value => value === 'never')) return;
    for (const candidate of await getSnapshots()) {
      if (candidate.unassigned_remote_copy) continue;
      const ids = Object.keys(candidate.remote_copies || {});
      const servers = ids.map((id) => config.servers.find((server) => server.id === id));
      if (!ids.length || servers.some(server => !server)) continue;
      const destinations = servers as ServerConfiguration[];
      const captures = (Object.keys(capturePlugins) as CaptureKind[]).filter(kind => candidate[kind]);
      const expired = captures.filter(kind => captureExpired(candidate, kind, config, destinations));
      const removeRow = destinations.every(server => isExpired(candidate, config, server)) && captures.length === expired.length;
      if (!removeRow && !expired.length) continue;
      if (!(await Promise.all(destinations.map((server) => hasServerHostPermission(server.server)))).every(Boolean)) continue;
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
          await mutateSnapshots(async (entries) => {
            const currentConfig = await getConfig();
            if (JSON.stringify(currentConfig.servers) !== JSON.stringify(config.servers)
              || currentConfig.local_retention_ms !== config.local_retention_ms
              || currentConfig.save_snapshots_locally !== config.save_snapshots_locally
              || JSON.stringify(currentConfig.capture_retention_ms) !== JSON.stringify(config.capture_retention_ms)) return entries;
            const snapshot = entries.find((item) => item.id === candidate.id);
            if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(candidate)) return entries;
            // Remove bytes first. Failures leave the record available for retry.
            await deleteSnapshotOpfs(snapshot, deleteRow ? undefined : confirmed);
            const prune = (item: Snapshot) => {
              if (item.id !== snapshot.id) return item;
              const next = { ...item };
              for (const kind of confirmed) delete next[kind];
              return next;
            };
            for (const area of [browser.storage.sync, browser.storage.session]) {
              if (!area) continue;
              const { entries: copies } = await area.get('entries');
              if (Array.isArray(copies) && copies.some((item: Snapshot) => item.id === snapshot.id)) {
                await area.set({ entries: deleteRow ? copies.filter((item: Snapshot) => item.id !== snapshot.id) : copies.map(prune) });
              }
            }
            return deleteRow ? entries.filter((item) => item.id !== snapshot.id) : entries.map(prune);
          });
        });
      });
    }
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
    if (area === 'local' && ['save_snapshots_locally', 'local_retention_ms', 'capture_retention_ms', 'server_registry'].some((key) => key in changes)) {
      void run();
    }
  });
  void schedule();
}
