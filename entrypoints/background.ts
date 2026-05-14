import { addToArchiveBox, archiveBoxSnapshotUrl, removeFromArchiveBox, testApiKey, testServerUrl } from '@/src/lib/archivebox';
import { defaultSingleFileExtensionId, mhtmlUnsupportedMessage, supportsMhtmlCapture } from '@/src/lib/browserCapabilities';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { appendSnapshotScreenshotParts, writeSnapshotMhtmlBytes, writeSnapshotScreenshot, writeSnapshotScreenshotParts, writeSnapshotSingleFileHtml } from '@/src/lib/screenshotStorage';
import { createSnapshot } from '@/src/lib/snapshots';
import { getArchiveBoxServerUrl, getConfig, getSnapshots, setSnapshots } from '@/src/lib/storage';
import type { RuntimeMessage, RuntimeResponse, Snapshot, SnapshotMhtml, SnapshotScreenshot, SnapshotSingleFile } from '@/src/lib/types';

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
  userCanceled?: boolean;
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
  executeScript<T = unknown>(details:
    | {
      target: { tabId: number };
      files: string[];
    }
    | {
      target: { tabId: number };
      func: () => T;
    }
  ): Promise<Array<{ result?: T }>>;
};

type CaptureArtifactOptions = {
  screenshot?: boolean;
  mhtml?: boolean;
  singlefile?: boolean;
};

type ScreenshotPartCanvas = {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
  height: number;
  width: number;
  xStart: number;
  yStart: number;
};

const maxScreenshotPngDimensionPixels = 10000;
const minCaptureVisibleTabIntervalMs = 700;
const maxFullPageScreenshotScrollCaptures = 20;
let captureVisibleTabReadyAt = 0;
let captureVisibleTabQueue: Promise<void> = Promise.resolve();
const canceledScreenshotCaptures = new Set<string>();
const completedCanceledScreenshotCaptures = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function withCaptureVisibleTabQuota<T>(task: () => Promise<T>): Promise<T> {
  const previous = captureVisibleTabQueue;
  let releaseQueue: () => void = () => undefined;
  captureVisibleTabQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  await previous.catch(() => undefined);
  try {
    const waitMs = Math.max(0, captureVisibleTabReadyAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    captureVisibleTabReadyAt = Date.now() + minCaptureVisibleTabIntervalMs;

    try {
      return await task();
    } catch (error) {
      if (!errorMessage(error).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
        throw error;
      }
      await sleep(minCaptureVisibleTabIntervalMs * 2);
      captureVisibleTabReadyAt = Date.now() + minCaptureVisibleTabIntervalMs;
      return task();
    }
  } finally {
    releaseQueue();
  }
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

async function blobToArrayBuffer(blob: Blob, label: string): Promise<ArrayBuffer> {
  try {
    return await blob.arrayBuffer();
  } catch (arrayBufferError) {
    if (typeof FileReader === 'function') {
      try {
        return await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error || arrayBufferError);
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) resolve(reader.result);
            else reject(new Error(t("Unable to read $1 as binary data.", label)));
          };
          reader.readAsArrayBuffer(blob);
        });
      } catch {
        // Try one more standards-based path below; Chromium can represent large
        // blobs with temporary files, and one reader may fail while another works.
      }
    }

    try {
      return await new Response(blob).arrayBuffer();
    } catch (responseError) {
      throw new Error(t("Failed to read $1: $2", label, errorMessage(responseError || arrayBufferError)));
    }
  }
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

function createScreenshotPartCanvases(width: number, height: number): ScreenshotPartCanvas[] {
  const parts: ScreenshotPartCanvas[] = [];
  for (let yStart = 0; yStart < height; yStart += maxScreenshotPngDimensionPixels) {
    const partHeight = Math.min(maxScreenshotPngDimensionPixels, height - yStart);
    for (let xStart = 0; xStart < width; xStart += maxScreenshotPngDimensionPixels) {
      const partWidth = Math.min(maxScreenshotPngDimensionPixels, width - xStart);
      const canvas = new OffscreenCanvas(partWidth, partHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t("Unable to prepare screenshot canvas."));
      parts.push({ canvas, context, height: partHeight, width: partWidth, xStart, yStart });
    }
  }
  return parts;
}

function drawBitmapIntoScreenshotParts(
  parts: ScreenshotPartCanvas[],
  bitmap: ImageBitmap,
  sourceWidth: number,
  sourceHeight: number,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  destinationHeight: number,
): void {
  const destinationRight = destinationX + destinationWidth;
  const destinationBottom = destinationY + destinationHeight;

  for (const part of parts) {
    const intersectLeft = Math.max(destinationX, part.xStart);
    const intersectTop = Math.max(destinationY, part.yStart);
    const intersectRight = Math.min(destinationRight, part.xStart + part.width);
    const intersectBottom = Math.min(destinationBottom, part.yStart + part.height);
    if (intersectLeft >= intersectRight || intersectTop >= intersectBottom) continue;

    const intersectWidth = intersectRight - intersectLeft;
    const intersectHeight = intersectBottom - intersectTop;
    const sourceX = ((intersectLeft - destinationX) / destinationWidth) * sourceWidth;
    const sourceY = ((intersectTop - destinationY) / destinationHeight) * sourceHeight;
    const sourceSliceWidth = (intersectWidth / destinationWidth) * sourceWidth;
    const sourceSliceHeight = (intersectHeight / destinationHeight) * sourceHeight;

    part.context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSliceWidth,
      sourceSliceHeight,
      intersectLeft - part.xStart,
      intersectTop - part.yStart,
      intersectWidth,
      intersectHeight,
    );
  }
}

async function writeBitmapScreenshotParts(
  snapshot: Snapshot,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<SnapshotScreenshot> {
  const partCanvases = createScreenshotPartCanvases(width, height);
  drawBitmapIntoScreenshotParts(
    partCanvases,
    bitmap,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  const partBlobs = await Promise.all(partCanvases.map(async (part) => ({
    blob: await part.canvas.convertToBlob({ type: 'image/png' }),
    x: part.xStart,
    y: part.yStart,
    width: part.canvas.width,
    height: part.canvas.height,
  })));
  return writeSnapshotScreenshotParts(snapshot, partBlobs, width, height);
}

async function captureVisibleTabPng(windowId: number): Promise<Blob> {
  if (typeof browser.tabs.captureVisibleTab !== 'function') {
    throw new Error(t("Screenshot capture is not available in this browser."));
  }
  const dataUrl = await withCaptureVisibleTabQuota(() => browser.tabs.captureVisibleTab(windowId, { format: 'png' }));
  return dataUrlToBlob(dataUrl);
}

async function captureVisibleScreenshot(tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<SnapshotScreenshot> {
  if (typeof tab.windowId !== 'number') throw new Error(t("No window ID available for screenshot capture."));
  if (typeof createImageBitmap !== 'function') {
    throw new Error(t("Screenshot capture is not available in this browser."));
  }
  const blob = await captureVisibleTabPng(tab.windowId);
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  if (width > maxScreenshotPngDimensionPixels || height > maxScreenshotPngDimensionPixels) {
    const screenshot = await writeBitmapScreenshotParts(snapshot, bitmap, width, height);
    bitmap.close();
    return screenshot;
  }
  bitmap.close();
  return writeSnapshotScreenshot(snapshot, blob, width, height);
}

function screenshotProgressTotal(metrics: PageMetrics | ScrollResult, captured: number): number {
  const scrollY = 'scrollY' in metrics ? metrics.scrollY : 0;
  const remainingHeight = Math.max(0, metrics.scrollHeight - scrollY - metrics.viewportHeight);
  const remainingScrolls = Math.ceil(remainingHeight / Math.max(1, metrics.viewportHeight));
  return Math.min(1 + maxFullPageScreenshotScrollCaptures, Math.max(captured, captured + remainingScrolls));
}

function sendScreenshotProgress(
  snapshotId: string,
  captured: number,
  total: number,
  phase: 'visible' | 'scrolling' | 'done' | 'canceled',
): void {
  browser.runtime.sendMessage<RuntimeMessage>({
    type: 'screenshot_capture_progress',
    snapshotId,
    captured,
    total: Math.max(captured, total),
    phase,
  }).catch(() => undefined);
}

async function ensureArchiveBoxContentScript(tab: Browser.tabs.Tab): Promise<void> {
  if (!tab.id) throw new Error(t("No tab ID available."));
  const permitted = await browser.permissions.contains({ permissions: ['scripting'] }).catch(() => true);
  if (!permitted) {
    throw new Error(t("Screenshot capture permission denied"));
  }

  const scripting = getScriptingApi();
  if (!scripting) {
    throw new Error(t("The scripting API is not available in this browser."));
  }

  await scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-scripts/archivebox.js'],
  });
}

async function measureScreenshotPage(tab: Browser.tabs.Tab): Promise<PageMetrics> {
  if (!tab.id) throw new Error(t("No tab ID available."));
  const scripting = getScriptingApi();
  if (!scripting) {
    throw new Error(t("The scripting API is not available in this browser."));
  }

  const [result] = await scripting.executeScript<PageMetrics>({
    target: { tabId: tab.id },
    func: () => {
      const documentElement = document.documentElement;
      const body = document.body;
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: Math.max(
          documentElement.scrollWidth,
          body?.scrollWidth || 0,
          documentElement.clientWidth,
        ),
        scrollHeight: Math.max(
          documentElement.scrollHeight,
          body?.scrollHeight || 0,
          documentElement.clientHeight,
        ),
        originalX: window.scrollX,
        originalY: window.scrollY,
      };
    },
  });
  if (!result?.result) throw new Error(t("Unable to measure page for screenshot capture."));
  return result.result;
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
  if (typeof createImageBitmap !== 'function') {
    throw new Error(t("Full-page screenshot stitching is not available in this browser."));
  }
  await ensureArchiveBoxContentScript(tab);

  const metrics = await browser.tabs.sendMessage<RuntimeMessage, PageMetrics>(tab.id as number, {
    type: 'screenshot_get_metrics',
  });

  const viewportWidth = Math.max(1, Math.floor(metrics.viewportWidth));
  const viewportHeight = Math.max(1, Math.floor(metrics.viewportHeight));
  const pageWidth = Math.max(viewportWidth, Math.floor(metrics.scrollWidth));
  const pageHeight = Math.max(viewportHeight, Math.floor(metrics.scrollHeight));
  if (pageWidth <= viewportWidth && pageHeight <= viewportHeight) {
    return snapshot.screenshot || captureVisibleScreenshot(tab, snapshot);
  }

  let baseScreenshot = snapshot.screenshot;
  if (!baseScreenshot) {
    baseScreenshot = await captureVisibleScreenshot(tab, snapshot);
    await attachScreenshotToSnapshot(snapshot.id, baseScreenshot);
  }

  const capturedPositions = new Set<string>();
  const partBlobs: Array<{ blob: Blob; x: number; y: number; width: number; height: number }> = [];
  let scaleX = 1;
  let scaleY = 1;
  let outputWidth = baseScreenshot.width;
  let outputHeight = 0;
  let scrollTargetY = 0;
  let canceled = false;
  sendScreenshotProgress(snapshot.id, 1, screenshotProgressTotal(metrics, 1), 'scrolling');

  try {
    for (let scrollCount = 0; scrollCount < maxFullPageScreenshotScrollCaptures; scrollCount += 1) {
      if (canceledScreenshotCaptures.has(snapshot.id)) {
        canceled = true;
        break;
      }

      const scroll = await browser.tabs.sendMessage<RuntimeMessage, ScrollResult>(tab.id as number, {
        type: 'screenshot_scroll',
        x: 0,
        y: scrollTargetY,
      });
      if (scroll.userCanceled) {
        canceled = true;
        break;
      }
      const key = `${scroll.scrollX}:${scroll.scrollY}`;
      if (capturedPositions.has(key)) break;
      capturedPositions.add(key);

      const blob = await captureVisibleTabPng(tab.windowId);
      const bitmap = await createImageBitmap(blob);
      scaleX = bitmap.width / viewportWidth;
      scaleY = bitmap.height / viewportHeight;

      const visibleCssWidth = Math.min(viewportWidth, Math.max(1, scroll.scrollWidth - scroll.scrollX));
      const visibleCssHeight = Math.min(viewportHeight, Math.max(1, scroll.scrollHeight - scroll.scrollY));
      const partWidth = Math.ceil(visibleCssWidth * scaleX);
      const partHeight = Math.ceil(visibleCssHeight * scaleY);
      outputWidth = Math.max(outputWidth, partWidth);
      outputHeight += partHeight;
      partBlobs.push({
        blob,
        x: Math.ceil(scroll.scrollX * scaleX),
        y: Math.ceil(scroll.scrollY * scaleY),
        width: partWidth,
        height: partHeight,
      });
      bitmap.close();

      const captured = 1 + partBlobs.length;
      const total = screenshotProgressTotal(scroll, captured);
      sendScreenshotProgress(snapshot.id, captured, total, 'scrolling');

      const refreshedMetrics = await browser.tabs.sendMessage<RuntimeMessage, PageMetrics>(tab.id as number, {
        type: 'screenshot_get_metrics',
      }).catch(() => scroll);
      const bottomY = Math.max(0, refreshedMetrics.scrollHeight - refreshedMetrics.viewportHeight);
      if (scroll.scrollY >= bottomY - 1) break;
      scrollTargetY = Math.min(bottomY, scroll.scrollY + refreshedMetrics.viewportHeight);
    }
  } finally {
    await browser.tabs.sendMessage<RuntimeMessage, unknown>(tab.id, {
      type: 'screenshot_restore_scroll',
      x: metrics.originalX,
      y: metrics.originalY,
    }).catch(() => undefined);
    canceledScreenshotCaptures.delete(snapshot.id);
  }

  if (partBlobs.length === 0) {
    if (canceled) {
      completedCanceledScreenshotCaptures.add(snapshot.id);
      sendScreenshotProgress(snapshot.id, 1, 1, 'canceled');
    }
    return baseScreenshot;
  }
  const screenshot = await appendSnapshotScreenshotParts(snapshot, baseScreenshot, partBlobs, outputWidth, outputHeight);
  if (canceled) completedCanceledScreenshotCaptures.add(snapshot.id);
  sendScreenshotProgress(
    snapshot.id,
    screenshot.parts?.length || 1,
    screenshot.parts?.length || 1,
    canceled ? 'canceled' : 'done',
  );
  return screenshot;
}

async function captureMhtml(tab: Browser.tabs.Tab, snapshot: Snapshot): Promise<SnapshotMhtml> {
  if (!tab.id) throw new Error(t("No tab ID available for MHTML capture."));
  if (!supportsMhtmlCapture) throw new Error(mhtmlUnsupportedMessage());
  const hasPermission = await browser.permissions.contains({ permissions: ['pageCapture'] }).catch(() => false);
  if (!hasPermission) throw new Error(t("MHTML capture permission denied"));

  const pageCapture = getChromeApis().pageCapture;
  if (!pageCapture) {
    throw new Error(t("MHTML capture is not available in this browser."));
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      pageCapture.saveAsMHTML({ tabId: tab.id as number }, (mhtmlData) => {
        const error = chromeLastError();
        if (error) {
          reject(new Error(`chrome.pageCapture.saveAsMHTML failed: ${error}`));
          return;
        }
        if (!mhtmlData) {
          reject(new Error(t("MHTML capture returned an empty file.")));
          return;
        }
        blobToArrayBuffer(mhtmlData, t("generated MHTML data")).then(resolve, reject);
      });
    });
  } catch (error) {
    throw new Error(errorMessage(error));
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
  } catch {
    throw new Error(t("Make sure you have SingleFile installed."));
  }

  if (!pageData?.content) {
    throw new Error(t("SingleFile capture returned an empty file."));
  }

  return writeSnapshotSingleFileHtml(snapshot, pageData.content, pageData.filename);
}

async function captureAndAttachSnapshotScreenshot(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
  fullPage = true,
): Promise<SnapshotScreenshot> {
  let screenshot: SnapshotScreenshot;
  if (!fullPage) {
    screenshot = await captureVisibleScreenshot(tab, snapshot);
  } else {
    try {
      screenshot = await captureFullPageScreenshot(tab, snapshot);
    } catch (error) {
      console.warn(`Falling back to visible-area screenshot for ${snapshot.url}:`, error);
      screenshot = await captureVisibleScreenshot(tab, snapshot);
    }
  }
  await attachScreenshotToSnapshot(snapshot.id, screenshot);
  return screenshot;
}

async function captureAndAttachSnapshotMhtml(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
): Promise<SnapshotMhtml> {
  const mhtml = await captureMhtml(tab, snapshot);
  await attachMhtmlToSnapshot(snapshot.id, mhtml);
  snapshot.mhtml = mhtml;
  return mhtml;
}

async function captureAndAttachSnapshotSingleFile(
  tab: Browser.tabs.Tab,
  snapshot: Snapshot,
): Promise<SnapshotSingleFile> {
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
    await captureAndAttachSnapshotScreenshot(tab, snapshot, true).catch((error) => {
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

async function saveTab(tab?: Browser.tabs.Tab): Promise<void> {
  if (!tab?.id || !tab.url) return;
  try {
    const { snapshot, created } = await ensureSnapshotForTab(tab);
    await captureConfiguredSnapshotArtifacts(tab, snapshot, created);
    await addToArchiveBox([snapshot.url], snapshot.tags, snapshot.depth ?? 0);
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
        return getSnapshots()
          .then(async (snapshots) => {
            const tab = await getMessageTab(message.tabId);
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotScreenshot(tab, snapshot, message.fullPage ?? true);
          })
          .then((screenshot) => {
            const screenshotCanceled = completedCanceledScreenshotCaptures.delete(message.snapshotId);
            return { ok: true, screenshot, screenshotCanceled };
          })
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'cancel_snapshot_screenshot':
        canceledScreenshotCaptures.add(message.snapshotId);
        return { ok: true };

      case 'measure_screenshot_page': {
        return getMessageTab(message.tabId)
          .then(measureScreenshotPage)
          .then((metrics) => ({
            ok: true,
            screenshotNeedsScroll: metrics.scrollWidth > metrics.viewportWidth || metrics.scrollHeight > metrics.viewportHeight,
          }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'capture_snapshot_mhtml': {
        return getSnapshots()
          .then(async (snapshots) => {
            const tab = await getMessageTab(message.tabId);
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotMhtml(tab, snapshot);
          })
          .then((mhtml) => ({ ok: true, mhtml }))
          .catch((error: Error) => ({ ok: false, errorMessage: error.message }));
      }

      case 'capture_snapshot_singlefile': {
        return getSnapshots()
          .then(async (snapshots) => {
            const tab = await getMessageTab(message.tabId);
            const snapshot = snapshots.find((item) => item.id === message.snapshotId);
            if (!snapshot) throw new Error(t("Saved snapshot not found."));
            return captureAndAttachSnapshotSingleFile(tab, snapshot);
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
