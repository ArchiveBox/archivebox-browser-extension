import { hasServerHostPermission, snapshotExistsOnServer } from './archivebox';
import { deleteSnapshotOpfs } from './screenshotStorage';
import { getConfig, getSnapshots, mutateSnapshots } from './storage';
import type { ConfigState, Snapshot } from './types';

const alarmName = 'archivebox-local-retention';

function isExpired(snapshot: Snapshot, config: ConfigState): boolean {
  if (config.local_retention_ms === 'never' || !config.archivebox_server_url) return false;
  const submitted = Date.parse(snapshot.archiveboxSubmittedAt || '');
  return Number.isFinite(submitted)
    && snapshot.archiveboxSubmittedTo === new URL(config.archivebox_server_url).origin
    && Date.now() - submitted >= config.local_retention_ms;
}

// Shared with capture and upload operations across popup/options/background contexts.
export async function withSnapshotArtifacts<T>(snapshotId: string, task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`archivebox-artifacts:${snapshotId}`, task);
}

export async function cleanupExpiredSnapshots(): Promise<void> {
  await navigator.locks.request(alarmName, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const config = await getConfig();
    if (!config.archivebox_server_url || config.local_retention_ms === 'never') return;
    if (!(await hasServerHostPermission(config.archivebox_server_url))) return;
    for (const candidate of await getSnapshots()) {
      if (!isExpired(candidate, config)) continue;
      await navigator.locks.request('archivebox-submissions', { ifAvailable: true }, async (submissionLock) => {
        if (!submissionLock) return;
        // Never interrupt a capture or upload. A later alarm will try again.
        await navigator.locks.request(`archivebox-artifacts:${candidate.id}`, { ifAvailable: true }, async (artifactLock) => {
          if (!artifactLock) return;
          // Only an authenticated, fresh, exact ID+URL match proves this local copy
          // is still backed by the configured server. No mutation is sent remotely.
          if (!(await snapshotExistsOnServer(candidate, config))) return;
          await mutateSnapshots(async (entries) => {
            const currentConfig = await getConfig();
            if (currentConfig.archivebox_server_url !== config.archivebox_server_url
              || currentConfig.archivebox_api_key !== config.archivebox_api_key) return entries;
            const snapshot = entries.find((item) => item.id === candidate.id);
            if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(candidate)
              || !isExpired(snapshot, currentConfig)) return entries;
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
    if (area === 'local' && ['local_retention_ms', 'archivebox_server_url', 'archivebox_api_key'].some((key) => key in changes)) {
      void run();
    }
  });
  void schedule();
}
