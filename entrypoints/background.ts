import { addToArchiveBox, archiveBoxSnapshotUrl, removeFromArchiveBox, testApiKey, testServerUrl } from '@/src/lib/archivebox';
import { defaultSingleFileExtensionId, mhtmlUnsupportedMessage, supportsMhtmlCapture } from '@/src/lib/browserCapabilities';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { writeSnapshotMhtmlBytes, writeSnapshotScreenshot, writeSnapshotSingleFileHtml } from '@/src/lib/screenshotStorage';
import { createSnapshot } from '@/src/lib/snapshots';
import { getArchiveBoxServerUrl, getConfig, getSnapshots, setSnapshots } from '@/src/lib/storage';
import type { RuntimeMessage, RuntimeResponse, Snapshot, SnapshotMhtml, SnapshotScreenshot, SnapshotSingleFile } from '@/src/lib/types';

type ActionClickApi = {
  onClicked: {
    addListener(listener: (tab: Browser.tabs.Tab) => void): void;
  };
};

type PageMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  originalX: number;
  originalY: number;
};

type ScrollResult = PageMetrics & {
  scrollX: number;
  scrollY: number;
};

type ChromeRuntimeApi = {
  lastError?: {
    message?: string;
  };
};

type ChromePageCaptureApi = {
  saveAsMHTML(
    details: { tabId: number },
    callback?: (mhtmlData?: Blob) => void,
  ): Promise<Blob | undefined> | void;
};

type ScriptingApi = {
  executeScript(details: {
    target: { tabId: number };
    files: string[];
  }): Promise<unknown[]>;
  insertCSS(details: {
    target: { tabId: number };
    files: string[];
  }): Promise<void>;
};

type CaptureArtifactOptions = {
  screenshot?: boolean;
  mhtml?: boolean;
  singlefile?: boolean;
};

type CaptureAttachOptions = {
  hideOverlay?: boolean;
};

function getActionApi(): ActionClickApi | undefined {
  const extensionBrowser = browser as unknown as {
    action?: ActionClickApi;
    browserAction?: ActionClickApi;
  };
  return extensionBrowser.action || extensionBrowser.browserAction;
}

function getChromeApis(): {
  pageCapture?: ChromePageCaptureApi;
  runtime?: ChromeRuntimeApi;
} {
  return (globalThis as unknown as {
    chrome?: {
      pageCapture?: ChromePageCaptureApi;
      runtime?: ChromeRuntimeApi;
    };
  }).chrome || {};
}

function getScriptingApi(): ScriptingApi | undefined {
  return (browser as unknown as { scripting?: ScriptingApi }).scripting;
}

function chromeLastError(): string {
  return getChromeApis().runtime?.lastError?.message || '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshUiLanguage(): Promise<void> {
  const { ui_language } = await getConfig();
  setUiLanguage(ui_language);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header = '', base64 = ''] = dataUrl.split(',');
  const mimeType = header.match(/^data:(.*?);base64$/)?.[1] || 'image/png';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function capturePositions(size: number, viewportSize: number): number[] {
  if (size <= viewportSize) return [0];
  const positions: number[] = [];
  for (let position = 0; position < size; position += viewportSize) {
    positions.push(position);
  }
  const finalPosition = Math.max(0, size - viewportSize);
  if (positions[positions.length - 1] !== finalPosition) positions.push(finalPosition);
  return positions;
}

async function captureVisibleTabPng(windowId: number): Promise<Blob> {
  if (typeof browser.tabs.captureVisibleTab !== 'function') {
    throw new Error(t("Screenshot capture is not available in this browser."));
  }
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  return dataUrlToBlob(dataUrl);
}

async function ensureArchiveBoxContentScript(tab: Browser.tabs.Tab): Promise<void> {
  if (!tab.id) throw new Error(t("No tab ID available."));
  const scripting = getScriptingApi();
  if (!scripting) {
    throw new Error(t("The scripting API is not available in this browser."));
  }

  await scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['content-scripts/archivebox.css'],
  }).catch(() => undefined);

  await scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-scripts/archivebox.js'],
  });
}

async function attachScreenshotToSnapshot(snapshotId: string, screenshot: SnapshotScreenshot): Promise<void> {
  const snapshots = await getSnapshots();
  await setSnapshots(snapshots.map((snapshot) => (
    snapshot.id === snapshotId ? { ...snapshot, screenshot } : snapshot
  )));
}

async function attachMhtmlToSnapshot(snapshotId: string, mhtml: SnapshotMhtml): Promise<void> {
  const snapshots = await getSnapshots();
  await setSnapshots(snapshots.map((snapshot) => (
    snapshot.id === snapshotId ? { ...snapshot, mhtml } : snapshot
  )));
}

async function attachSingleFileToSnapshot(snapshotId: string, singlefile: SnapshotSingleFile): Promise<void> {
  const snapshots = await getSnapshots();
  await setSnapshots(snapshots.map((snapshot) => (
    snapshot.id === snapshotId ? { ...snapshot, singlefile } : snapshot
  )));
}

async function captureFullPageScreenshot(tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<SnapshotScreenshot> {
  if (!tab.id) throw new Error(t("No tab ID available for screenshot capture."));
  if (typeof tab.windowId !== 'number') throw new Error(t("No window ID available for screenshot capture."));
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error(t("Full-page screenshot stitching is not available in this browser."));
  }
  await ensureArchiveBoxContentScript(tab);

  const metrics = await browser.tabs.sendMessage<RuntimeMessage, PageMetrics>(tab.id, {
    type: 'screenshot_get_metrics',
  });

  const viewportWidth = Math.max(1, Math.floor(metrics.viewportWidth));
  const viewportHeight = Math.max(1, Math.floor(metrics.viewportHeight));
  const pageWidth = Math.max(viewportWidth, Math.floor(metrics.scrollWidth));
  const pageHeight = Math.max(viewportHeight, Math.floor(metrics.scrollHeight));
  const xPositions = capturePositions(pageWidth, viewportWidth);
  const yPositions = capturePositions(pageHeight, viewportHeight);
  const capturedPositions = new Set<string>();
  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let scaleX = 1;
  let scaleY = 1;

  try {
    for (const y of yPositions) {
      for (const x of xPositions) {
        const scroll = await browser.tabs.sendMessage<RuntimeMessage, ScrollResult>(tab.id, {
          type: 'screenshot_scroll',
          x,
          y,
        });
        const key = `${scroll.scrollX}:${scroll.scrollY}`;
        if (capturedPositions.has(key)) continue;
        capturedPositions.add(key);

        const blob = await captureVisibleTabPng(tab.windowId);
        const bitmap = await createImageBitmap(blob);
        scaleX = bitmap.width / viewportWidth;
        scaleY = bitmap.height / viewportHeight;
        if (!canvas) {
          canvas = new OffscreenCanvas(Math.ceil(pageWidth * scaleX), Math.ceil(pageHeight * scaleY));
          context = canvas.getContext('2d');
        }
        if (!context) throw new Error(t("Unable to prepare screenshot canvas."));
        const drawingContext = context;

        const visibleCssWidth = Math.min(viewportWidth, pageWidth - scroll.scrollX);
        const visibleCssHeight = Math.min(viewportHeight, pageHeight - scroll.scrollY);
        drawingContext.drawImage(
          bitmap,
          0,
          0,
          Math.ceil(visibleCssWidth * scaleX),
          Math.ceil(visibleCssHeight * scaleY),
          Math.ceil(scroll.scrollX * scaleX),
          Math.ceil(scroll.scrollY * scaleY),
          Math.ceil(visibleCssWidth * scaleX),
          Math.ceil(visibleCssHeight * scaleY),
        );
        bitmap.close();
      }
    }
  } finally {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'screenshot_restore_scroll',
      x: metrics.originalX,
      y: metrics.originalY,
    }).catch(() => undefined);
  }

  if (!canvas) throw new Error(t("No screenshot tiles were captured."));
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return writeSnapshotScreenshot(snapshot, blob, canvas.width, canvas.height);
}

async function captureMhtml(tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<SnapshotMhtml> {
  if (!tab.id) throw new Error(t("No tab ID available for MHTML capture."));
  if (!supportsMhtmlCapture) throw new Error(mhtmlUnsupportedMessage());
  const hasPermission = await browser.permissions.contains({ permissions: ['pageCapture'] }).catch(() => false);
  if (!hasPermission) {
    const granted = await browser.permissions.request({ permissions: ['pageCapture'] }).catch(() => false);
    if (!granted) throw new Error(t("MHTML capture permission denied"));
  }

  const pageCapture = getChromeApis().pageCapture;
  if (!pageCapture) {
    throw new Error(t("MHTML capture is not available in this browser."));
  }

  let blob: Blob | undefined;
  try {
    const maybePromise = pageCapture.saveAsMHTML({ tabId: tab.id as number });
    if (maybePromise && typeof maybePromise.then === 'function') {
      blob = await maybePromise;
    } else {
      blob = await new Promise<Blob | undefined>((resolve, reject) => {
        pageCapture.saveAsMHTML({ tabId: tab.id as number }, (mhtmlData) => {
          const error = chromeLastError();
          if (error) {
            reject(new Error(`chrome.pageCapture.saveAsMHTML failed: ${error}`));
            return;
          }
          resolve(mhtmlData);
        });
      });
    }
  } catch (error) {
    throw new Error(`chrome.pageCapture.saveAsMHTML failed: ${errorMessage(error)}`);
  }

  if (!blob) throw new Error(t("MHTML capture returned an empty file."));

  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch (error) {
    throw new Error(`Failed to read generated MHTML data: ${errorMessage(error)}`);
  }

  return writeSnapshotMhtmlBytes(snapshot, bytes);
}

type SingleFileCaptureResult = {
  content?: string;
  filename?: string;
  mimeType?: string;
  title?: string;
  url?: string;
};

async function captureSingleFileHtml(_tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<SnapshotSingleFile> {
  if (!_tab.id) throw new Error(t("No tab ID available for SingleFile capture."));
  await ensureArchiveBoxContentScript(_tab);
  const { singlefile_extension_id } = await getConfig();
  const extensionId = singlefile_extension_id.trim() || defaultSingleFileExtensionId;
  if (!extensionId) {
    throw new Error(t("SingleFile extension ID is not configured."));
  }

  const sendExternalMessage = browser.runtime.sendMessage as unknown as (
    extensionId: string,
    message: unknown,
  ) => Promise<SingleFileCaptureResult>;

  let pageData: SingleFileCaptureResult;
  try {
    pageData = await sendExternalMessage(extensionId, {
      method: 'capture-page',
      tabId: _tab.id,
      displayName: t("ArchiveBox"),
    });
  } catch (error) {
    throw new Error(t("SingleFile capture failed.", errorMessage(error)));
  }

  if (!pageData?.content) {
    throw new Error(t("SingleFile capture returned an empty file."));
  }

  return writeSnapshotSingleFileHtml(snapshot, pageData.content, pageData.filename);
}

async function captureAndAttachSnapshotScreenshot(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  options: CaptureAttachOptions = {},
): Promise<SnapshotScreenshot> {
  if (options.hideOverlay !== false && tab.id) {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'hide_archivebox_overlay',
    }).catch(() => undefined);
  }
  const screenshot = await captureFullPageScreenshot(tab, snapshot);
  await attachScreenshotToSnapshot(snapshot.id, screenshot);
  return screenshot;
}

async function captureAndAttachSnapshotMhtml(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  options: CaptureAttachOptions = {},
): Promise<SnapshotMhtml> {
  if (options.hideOverlay !== false && tab.id) {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'hide_archivebox_overlay',
    }).catch(() => undefined);
  }
  const mhtml = await captureMhtml(tab, snapshot);
  await attachMhtmlToSnapshot(snapshot.id, mhtml);
  snapshot.mhtml = mhtml;
  return mhtml;
}

async function captureAndAttachSnapshotSingleFile(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  options: CaptureAttachOptions = {},
): Promise<SnapshotSingleFile> {
  if (options.hideOverlay !== false && tab.id) {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'hide_archivebox_overlay',
    }).catch(() => undefined);
  }
  const singlefile = await captureSingleFileHtml(tab, snapshot);
  await attachSingleFileToSnapshot(snapshot.id, singlefile);
  snapshot.singlefile = singlefile;
  return singlefile;
}

async function captureAndAttachSnapshotArtifacts(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  options: CaptureArtifactOptions,
): Promise<void> {
  if (tab.id) {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'hide_archivebox_overlay',
    }).catch(() => undefined);
  }

  if (options.mhtml) {
    await captureAndAttachSnapshotMhtml(tab, snapshot).catch((error) => {
      console.error(`Failed to capture MHTML for ${snapshot.url}:`, error);
    });
  }

  if (options.singlefile) {
    await captureAndAttachSnapshotSingleFile(tab, snapshot).catch((error) => {
      console.error(`Failed to capture SingleFile HTML for ${snapshot.url}:`, error);
    });
  }

  if (options.screenshot) {
    await captureAndAttachSnapshotScreenshot(tab, snapshot).catch((error) => {
      console.error(`Failed to capture screenshot for ${snapshot.url}:`, error);
    });
  }
}

async function configuredCaptureOptions(snapshot: Snapshot, created: boolean): Promise<CaptureArtifactOptions> {
  const {
    save_screenshots_locally,
    save_mhtml_locally,
    save_singlefile_locally,
  } = await getConfig();
  const wantsScreenshot = save_screenshots_locally && (created || !snapshot.screenshot);
  const wantsMhtml = supportsMhtmlCapture && save_mhtml_locally && (created || !snapshot.mhtml);
  const wantsSingleFile = save_singlefile_locally && (created || !snapshot.singlefile);

  if (!wantsScreenshot && !wantsMhtml && !wantsSingleFile) return {};

  return {
    screenshot: wantsScreenshot,
    mhtml: wantsMhtml,
    singlefile: wantsSingleFile,
  };
}

async function captureConfiguredSnapshotArtifacts(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  created: boolean,
): Promise<void> {
  const options = await configuredCaptureOptions(snapshot, created);
  if (!options.screenshot && !options.mhtml && !options.singlefile) return;
  await captureAndAttachSnapshotArtifacts(tab, snapshot, options);
}

async function ensureSnapshotForTab(tab: Browser.tabs.Tab): Promise<{
  snapshot: Snapshot;
  created: boolean;
}> {
  if (!tab.url) throw new Error(t("No URL found for the current tab."));
  const snapshots = await getSnapshots();
  let snapshot = snapshots.find((item) => item.url === tab.url);
  let created = false;

  if (!snapshot) {
    snapshot = createSnapshot(
      tab.url,
      [],
      tab.title || '',
      tab.favIconUrl || null,
    );
    snapshots.push(snapshot);
    created = true;
  } else {
    snapshot.title = snapshot.title || tab.title || '';
    snapshot.favIconUrl = snapshot.favIconUrl || tab.favIconUrl || null;
  }

  await setSnapshots(snapshots);
  return { snapshot, created };
}

async function shouldAutoArchive(url: string): Promise<boolean> {
  try {
    const { enable_auto_archive, match_urls, exclude_urls } = await getConfig();
    if (!enable_auto_archive || !match_urls.trim()) return false;

    if (!new RegExp(match_urls).test(url)) return false;
    if (exclude_urls.trim() && new RegExp(exclude_urls).test(url)) return false;

    return true;
  } catch (error) {
    console.error('Error checking auto-archive patterns:', error);
    return false;
  }
}

async function autoArchive(
  _tabId: number,
  changeInfo: { status?: string },
  tab: Browser.tabs.Tab,
): Promise<void> {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const snapshots = await getSnapshots();
  if (snapshots.some((snapshot) => snapshot.url === tab.url)) return;
  if (!(await shouldAutoArchive(tab.url))) return;

  const snapshot = createSnapshot(
    tab.url,
    ['auto-archived'],
    tab.title || '',
    tab.favIconUrl || null,
  );
  snapshots.push(snapshot);
  await setSnapshots(snapshots);

  captureConfiguredSnapshotArtifacts(tab, snapshot, true).catch((error) => {
    console.error(`Failed to capture local artifacts for ${snapshot.url}:`, error);
  });

  try {
    await addToArchiveBox([snapshot.url], snapshot.tags);
  } catch (error) {
    console.error(`Failed to automatically archive ${snapshot.url}:`, error);
  }
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

async function showOverlay(tab?: Browser.tabs.Tab): Promise<void> {
  if (!tab?.id) return;
  try {
    await ensureArchiveBoxContentScript(tab);
    const { snapshot, created } = await ensureSnapshotForTab(tab);
    await captureConfiguredSnapshotArtifacts(tab, snapshot, created);
    await browser.tabs.sendMessage(tab.id, { type: 'show_archivebox_overlay' } satisfies RuntimeMessage);
  } catch (error) {
    console.error('Failed to show ArchiveBox overlay:', error);
  }
}

export default defineBackground(() => {
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
    showOverlay(tab);
  });

  getActionApi()?.onClicked.addListener((tab) => {
    showOverlay(tab);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-to-archivebox-action') return;
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    await showOverlay(activeTab);
  });

  browser.runtime.onMessage.addListener((
    message: RuntimeMessage,
    sender,
  ): Promise<RuntimeResponse> | RuntimeResponse => {
    switch (message.type) {
      case 'archivebox_add':
        return addToArchiveBox(message.body.urls, message.body.tags, message.body.depth ?? 0)
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      case 'archivebox_remove':
        return removeFromArchiveBox(message.url)
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      case 'capture_snapshot_screenshot': {
        const tab = sender.tab;
        if (!tab?.id) return { ok: false, errorMessage: t("Open the ArchiveBox popup on the page before saving a screenshot.") };
        return getSnapshots()
          .then((snapshots) => {
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotScreenshot(tab, snapshot, { hideOverlay: false });
          })
          .then((screenshot) => ({ ok: true, screenshot }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'capture_snapshot_mhtml': {
        const tab = sender.tab;
        if (!tab?.id) return { ok: false, errorMessage: t("Open the ArchiveBox popup on the page before saving MHTML.") };
        return getSnapshots()
          .then((snapshots) => {
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotMhtml(tab, snapshot, { hideOverlay: false });
          })
          .then((mhtml) => ({ ok: true, mhtml }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'capture_snapshot_singlefile': {
        const tab = sender.tab;
        if (!tab?.id) return { ok: false, errorMessage: t("Open the ArchiveBox popup on the page before saving SingleFile HTML.") };
        return getSnapshots()
          .then((snapshots) => {
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotSingleFile(tab, snapshot, { hideOverlay: false });
          })
          .then((singlefile) => ({ ok: true, singlefile }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'test_server_url':
        return testServerUrl(message.serverUrl)
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, error: error.message }));

      case 'test_api_key':
        return testApiKey(message.serverUrl, message.apiKey)
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
        return getArchiveBoxServerUrl()
          .then((serverUrl) => {
            if (!serverUrl) throw new Error(t("Server not configured"));
            return browser.tabs.create({ url: archiveBoxSnapshotUrl(serverUrl, message.url) });
          })
          .then(() => ({ ok: true }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));

      default:
        return { ok: false, error: t("Unknown message type") };
    }
  });

  configureAutoArchiving();
});
