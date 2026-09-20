import { hasServerHostPermission, snapshotExistsOnServer } from './archivebox';
import { deleteSnapshotOpfs } from './screenshotStorage';
import { getConfig, getSnapshots, mutateSnapshots } from './storage';
import type { ConfigState, Snapshot, ServerConfiguration } from './types';

const alarmName = 'archivebox-local-retention';

function isExpired(snapshot: Snapshot, config: ConfigState, server: ServerConfiguration): boolean {
  if (config.local_retention_ms === 'never' || snapshot.remote_copies?.[server.id]?.status !== 'complete') return false;
  const submitted = Date.parse(snapshot.remote_copies?.[server.id]?.submitted_at || '');
  return Number.isFinite(submitted)
    && snapshot.remote_copies?.[server.id]?.submitted_to === new URL(server.server).toString().replace(/\/$/, '')
    && Date.now() - submitted >= config.local_retention_ms;
}

// Shared with capture and upload operations across popup/options/background contexts.
export async function withSnapshotArtifacts<T>(snapshot_id: string, task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`archivebox-artifacts:${snapshot_id}`, task);
}

export async function cleanupExpiredSnapshots(): Promise<void> {
  await navigator.locks.request(alarmName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const config = await getConfig();
    if (config.local_retention_ms === 'never') return;
    for (const candidate of await getSnapshots()) {
      if (candidate.unassigned_remote_copy) continue;
      const ids = Object.keys(candidate.remote_copies || {});
      const servers = ids.map((id) => config.servers.find((server) => server.id === id));
      if (!ids.length || servers.some((server) => !server || !isExpired(candidate, config, server))) continue;
      const destinations = servers as ServerConfiguration[];
      if (!(await Promise.all(destinations.map((server) => hasServerHostPermission(server.server)))).every(Boolean)) continue;
      await navigator.locks.request(`archivebox-delivery:${candidate.id}`, { ifAvailable: true }, async (submissionLock) => {
        if (!submissionLock) return;
        // Never interrupt a capture or upload. A later alarm will try again.
        await navigator.locks.request(`archivebox-artifacts:${candidate.id}`, { ifAvailable: true }, async (artifactLock) => {
          if (!artifactLock) return;
          // Only an authenticated, fresh, exact ID+URL match proves this local copy
          // is still backed by the configured server. No mutation is sent remotely.
          if (!(await Promise.all(destinations.map((server) => snapshotExistsOnServer(candidate, server)))).every(Boolean)) return;
          await mutateSnapshots(async (entries) => {
            const currentConfig = await getConfig();
            if (JSON.stringify(currentConfig.servers) !== JSON.stringify(config.servers)) return entries;
            const snapshot = entries.find((item) => item.id === candidate.id);
            if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(candidate)
              || !destinations.every((server) => isExpired(snapshot, currentConfig, server))) return entries;
            // Remove bytes first. Failures leave the record available for retry.
            await deleteSnapshotOpfs(snapshot);
            for (const area of [browser.storage.sync, browser.storage.session]) {
              if (!area) continue;
              const { entries: copies } = await area.get('entries');
              if (Array.isArray(copies) && copies.some((item: Snapshot) => item.id === snapshot.id)) {
                await area.set({ entries: copies.filter((item: Snapshot) => item.id !== snapshot.id) });
              }
            }
            return entries.filter((item) => item.id !== snapshot.id);
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
    if (area === 'local' && ['local_retention_ms', 'server_registry'].some((key) => key in changes)) {
      void run();
    }
  });
  void schedule();
}
