import { defaultServers, requireServer } from '@/src/lib/server_registry';
import { configureLocalRetention } from '@/src/lib/retention';
import { configureCookieSync } from '@/src/lib/cookieSync';
import { findSubmittedSnapshot, removeFreshOwnedCapture, submitSnapshot, addToArchiveBox, archiveBoxServerUrlMatches, archiveBoxSnapshotUrl, isArchiveablePageUrl, isConfiguredArchiveBoxUrl, removeFromArchiveBox, supportsArchiveBoxApi, testApiKey, testServerUrl } from '@/src/lib/archivebox';
import { supportsWaczCapture } from '@/src/lib/browserCapabilities';
import { openCapture, configureCaptureRuntime } from '@/src/capture/background';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { createSnapshot } from '@/src/lib/snapshots';
import { getArchiveBoxServerUrl, getConfig, getPersonas, getSnapshots, mutateSnapshots } from '@/src/lib/storage';
import type { RuntimeMessage, RuntimeResponse, Snapshot } from '@/src/lib/types';

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function refreshUiLanguage() { setUiLanguage((await getConfig()).ui_language); }
async function captureSnapshot(tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<void> {
  if (!supportsWaczCapture) return;
  await openCapture(snapshot.id, tab.id!);
}

async function ensureSnapshotForTab(tab: Browser.tabs.Tab): Promise<Snapshot> {
  if (!tab.url) throw new Error(t("No URL found for the current tab."));
  let snapshot!: Snapshot;
  await mutateSnapshots((snapshots) => {
    snapshot = [...snapshots].reverse().find((item) => item.url === tab.url)!;

    if (!snapshot) {
      snapshot = createSnapshot(
        tab.url!,
        [],
        tab.title || '',
        tab.favIconUrl || null,
      );
      snapshots.push(snapshot);
    } else {
      snapshot.title = snapshot.title || tab.title || '';
      snapshot.favIconUrl = snapshot.favIconUrl || tab.favIconUrl || null;
    }

    return snapshots;
  });
  return snapshot;
}

async function shouldAutoArchive(url: string): Promise<boolean> {
  try {
    if (!isArchiveablePageUrl(url)) return false;
    const config = await getConfig();
    const { enable_auto_archive, match_urls, exclude_urls } = config;
    if (!enable_auto_archive || !match_urls.trim()) return false;
    if (config.servers.some((server) => server.server && archiveBoxServerUrlMatches(server.server, url))) return false;

    if (!new RegExp(match_urls).test(url)) return false;
    if (exclude_urls.trim() && new RegExp(exclude_urls).test(url)) return false;

    return true;
  } catch (error) {
    console.error('Error checking auto-archive patterns:', error);
    return false;
  }
}

async function getSnapshotById(snapshot_id: string): Promise<Snapshot | null> {
  return (await getSnapshots()).find((snapshot) => snapshot.id === snapshot_id) || null;
}

async function syncSnapshotToServer(snapshot: Snapshot): Promise<boolean> {
  const server = defaultServers(await getConfig())[0];
  if (!server) return false;
  try {
    await submitSnapshot(server, snapshot);
    return true;
  } catch (error) {
    console.warn(`ArchiveBox: submission to ${server.id} failed: ${errorMessage(error)}`);
    return false;
  }
}

async function autoArchive(
  _tabId: number,
  changeInfo: { status?: string },
  tab: Browser.tabs.Tab,
): Promise<void> {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (!isArchiveablePageUrl(tab.url)) return;

  const snapshots = await getSnapshots();
  if (snapshots.some((snapshot) => snapshot.url === tab.url)) return;
  if (!(await shouldAutoArchive(tab.url))) return;

  const snapshot = createSnapshot(
    tab.url,
    ['auto-archived'],
    tab.title || '',
    tab.favIconUrl || null,
  );
  let added = false;
  await mutateSnapshots((items) => {
    if (items.some((item) => item.url === snapshot.url)) return items;
    added = true;
    return [...items, snapshot];
  });
  if (!added) return;
  console.info(`ArchiveBox: auto-archiving ${snapshot.url}`);

  await captureSnapshot(tab, snapshot).catch((error) => {
    console.error(`Failed to capture local artifacts for ${snapshot.url}:`, error);
  });
  await syncSnapshotToServer(snapshot);
}

async function configureAutoArchiving(): Promise<void> {
  const hasPermission = await browser.permissions.contains({ permissions: ['tabs'] });
  if (!hasPermission) return;

  const { enable_auto_archive } = await getConfig();
  const hasListener = browser.tabs.onUpdated.hasListener(autoArchive);

  if (enable_auto_archive && !hasListener) {
    browser.tabs.onUpdated.addListener(autoArchive);
  } else if (!enable_auto_archive && hasListener) {
    browser.tabs.onUpdated.removeListener(autoArchive);
  }
}

async function saveTab(tab?: Browser.tabs.Tab): Promise<void> {
  if (!tab?.id || !tab.url) return;
  if (!isArchiveablePageUrl(tab.url)) return;
  if (await isConfiguredArchiveBoxUrl(tab.url)) return;
  console.info(`ArchiveBox: saving ${tab.url}`);
  try {
    const snapshot = await ensureSnapshotForTab(tab);
    await captureSnapshot(tab, snapshot);
    await syncSnapshotToServer(snapshot);
  } catch (error) {
    console.error('Failed to save tab to ArchiveBox:', error);
  }
}

async function getMessageTab(tabId: number): Promise<Browser.tabs.Tab> {
  const tab = await browser.tabs.get(tabId);
  if (!tab?.id) throw new Error(t("No tab ID available."));
  return tab;
}

export default defineBackground(() => {
  configureCaptureRuntime();
  configureCookieSync();
  configureLocalRetention();
  refreshUiLanguage().catch(() => undefined);
  browser.runtime.onStartup.addListener(configureAutoArchiving);
  browser.runtime.onInstalled.addListener(() => {
    refreshUiLanguage()
      .catch(() => undefined)
      .then(() => {
        browser.contextMenus.removeAll();
        browser.contextMenus.create({
          id: 'save_to_archivebox_ctxmenu',
          title: t("Save to ArchiveBox"),
          contexts: ['page'],
        });
        configureAutoArchiving();
      });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enable_auto_archive) {
      configureAutoArchiving();
    }
    if (area === 'local' && changes.ui_language) {
      refreshUiLanguage()
        .then(() => browser.contextMenus.update('save_to_archivebox_ctxmenu', { title: t("Save to ArchiveBox") }))
        .catch(() => undefined);
    }
  });

  browser.contextMenus.onClicked.addListener((_item, tab) => {
    saveTab(tab);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-to-archivebox-action') return;
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    await saveTab(activeTab);
  });

  browser.runtime.onMessage.addListener((
    message: RuntimeMessage,
    _sender,
  ): Promise<RuntimeResponse> | RuntimeResponse | undefined => {
    switch (message.type) {
      case 'archivebox_add':
        return getConfig().then(async (config) => {
          const configuredServer = requireServer(config, message.server_id);
          let server = configuredServer;
          if (message.body.persona !== undefined) {
            const localPersona = configuredServer.policy.local_persona_id
              ? (await getPersonas()).personas.find(item => item.id === configuredServer.policy.local_persona_id)
              : undefined;
            // Existing cookie consent is for that local profile, not a newly selected persona.
            server = { ...configuredServer, persona: message.body.persona, policy: {
              ...configuredServer.policy,
              local_persona_id: localPersona?.name === message.body.persona ? localPersona.id : undefined,
            } };
          }
          const snapshot = (await getSnapshots()).find((item) => item.id === message.body.snapshot_ids?.[0] && item.url === message.body.urls[0]);
          if (snapshot && message.body.urls.length === 1) {
            if (message.body.replace_fresh) await removeFreshOwnedCapture(server, snapshot);
            return new Promise<Awaited<ReturnType<typeof submitSnapshot>>>((resolve, reject) => {
              void submitSnapshot(server, { ...snapshot, tags: message.body.tags, depth: message.body.depth ?? 0 }, undefined, resolve, message.body.only_new)
                .then(resolve, reject);
            });
          }
          return addToArchiveBox(server, message.body.urls, message.body.tags, message.body.depth ?? 0, false, false, message.body.snapshot_ids || [], message.body.only_new);
        })
          .then((receipt) => ({ ok: true, receipt }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      case 'archivebox_remove':
        return getConfig().then(async (config) => {
          const snapshot = await getSnapshotById(message.snapshot_id);
          if (!snapshot) throw new Error('Saved URL not found.');
          return removeFromArchiveBox(requireServer(config, message.server_id), snapshot);
        })
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      case 'capture_snapshot_wacz':
        return openCapture(message.snapshot_id, message.tabId)
          .then(() => ({ok:true})).catch(error => ({ok:false,errorMessage:String(error)}));
      case 'open_snapshot_wacz':
        return openCapture(message.snapshot_id)
          .then(() => ({ok:true})).catch(error => ({ok:false,errorMessage:String(error)}));

      case 'test_server_url':
        return testServerUrl(message.server)
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, error: error.message }));

      case 'test_api_key':
        return testApiKey(message.server, message.token)
          .then((user_id) => ({ ok: true, user_id }))
          .catch((error: Error) => ({ ok: false, error: error.message }));

      case 'open_options': {
        const queryKey = message.view === 'screenshot'
          ? 'screenshot'
          : message.view === 'mhtml'
            ? 'mhtml'
            : message.view === 'singlefile'
              ? 'singlefile'
              : 'highlight';
        const url = browser.runtime.getURL(
          `/options.html${message.id ? `?${queryKey}=${encodeURIComponent(message.id)}` : ''}`,
        );
        return browser.tabs.create({ url }).then(() => ({ ok: true }));
      }

      case 'open_archivebox_snapshot':
        return getConfig()
          .then(async (config) => {
            const server = requireServer(config, message.server_id);
            const serverUrl = server.server;
            if (!serverUrl) throw new Error(t("Server not configured"));
            const modernApi = await supportsArchiveBoxApi(serverUrl).catch(() => true);
            let snapshotId: string | undefined;
            if (modernApi) {
              const copy = (await getSnapshots()).find(item => item.url === message.url)?.remote_copies?.[server.id];
              snapshotId = copy?.submitted_to === new URL(serverUrl).toString().replace(/\/$/, '') ? copy.snapshot_id : undefined;
              snapshotId ||= (await findSubmittedSnapshot(server, message.url))?.id;
              if (!snapshotId) throw new Error(t("The URL is queued, but its archived copy is not available yet."));
            }
            return browser.tabs.create({ url: archiveBoxSnapshotUrl(serverUrl, message.url, !modernApi, snapshotId) });
          })
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      default:
        return undefined;
    }
  });

  configureAutoArchiving();
});
