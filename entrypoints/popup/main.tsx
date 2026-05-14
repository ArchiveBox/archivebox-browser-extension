import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { mhtmlUnsupportedMessage, singleFileCaptureUnavailableMessage, singleFileChromeWebStoreUrl, supportsMhtmlCapture } from '@/src/lib/browserCapabilities';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { assertLocalCaptureStorageAvailable } from '@/src/lib/screenshotStorage';
import { createSnapshot } from '@/src/lib/snapshots';
import { getConfig, getSnapshots, setSnapshots } from '@/src/lib/storage';
import { matchingTagSuggestions } from '@/src/lib/tags';
import type { ArchiveDepth, RuntimeMessage, RuntimeResponse, Snapshot } from '@/src/lib/types';
import './style.css';

type RemoteArchiveStatus = 'not_archived' | 'archived' | 'server_not_connected';
type LocalArchiveStatus = 'saved' | 'unsaved' | 'removed';
type ScreenshotCaptureState = {
  phase: 'idle' | 'visible' | 'capturing' | 'canceling';
  captured: number;
  total: number;
  snapshotId?: string;
};
type ActivePage = {
  favIconUrl?: string | null;
  tabId: number;
  title: string;
  url: string;
  windowId: number;
};

function crawlDepthOptions(): Array<{
  value: ArchiveDepth;
  label: string;
}> {
  return [
    { value: 0, label: t("Depth 0: just this page") },
    { value: 1, label: t("Depth 1: linked pages within") },
    { value: 2, label: t("Depth 2: links two hops out") },
    { value: 3, label: t("Depth 3: links three hops out") },
    { value: 4, label: t("Depth 4: maximum allowed") },
  ];
}

async function getActivePage(): Promise<ActivePage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error(t("No URL found for the current tab."));
  return {
    favIconUrl: tab.favIconUrl || null,
    tabId: tab.id,
    title: tab.title || t("Untitled page"),
    url: tab.url,
    windowId: tab.windowId,
  };
}

function toArchiveDepth(value: number): ArchiveDepth {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  return 4;
}

async function getCurrentSnapshot(activePage: ActivePage): Promise<{
  currentSnapshot: Snapshot;
  snapshots: Snapshot[];
  created: boolean;
}> {
  const snapshots = await getSnapshots();
  const pageUrl = activePage.url;
  let currentSnapshot = snapshots.find((snapshot) => snapshot.url === pageUrl);
  let created = false;

  if (!currentSnapshot) {
    currentSnapshot = createSnapshot(pageUrl, [], activePage.title, activePage.favIconUrl || null);
    snapshots.push(currentSnapshot);
    await setSnapshots(snapshots);
    created = true;
  } else {
    currentSnapshot.title = currentSnapshot.title || activePage.title;
    currentSnapshot.favIconUrl = currentSnapshot.favIconUrl || activePage.favIconUrl || null;
  }

  return { currentSnapshot, snapshots, created };
}

function unsavedSnapshot(activePage: ActivePage | null): Snapshot | null {
  if (!activePage) return null;
  return createSnapshot(activePage.url, [], activePage.title, activePage.favIconUrl || null);
}

function ArchiveBoxOverlay() {
  const [activePage, setActivePage] = useState<ActivePage | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(t("Saved locally..."));
  const [statusLink, setStatusLink] = useState<{ href: string; label: string; status: string } | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [depth, setDepth] = useState<ArchiveDepth>(0);
  const [localStatus, setLocalStatus] = useState<LocalArchiveStatus>('unsaved');
  const [remoteStatus, setRemoteStatus] = useState<RemoteArchiveStatus>('not_archived');
  const [remoteDetail, setRemoteDetail] = useState('');
  const [crawlMenuOpen, setCrawlMenuOpen] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [screenshotCapture, setScreenshotCapture] = useState<ScreenshotCaptureState>({
    phase: 'idle',
    captured: 0,
    total: 0,
  });

  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type !== 'screenshot_capture_progress') return undefined;
      setScreenshotCapture((current) => {
        if (current.snapshotId && current.snapshotId !== message.snapshotId) return current;
        const nextPhase = message.phase === 'scrolling'
          ? 'capturing'
          : message.phase === 'visible'
            ? 'visible'
            : current.phase;
        return {
          phase: nextPhase,
          snapshotId: message.snapshotId,
          captured: message.captured,
          total: message.total,
        };
      });
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function refresh() {
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot, snapshots } = await getCurrentSnapshot(nextActivePage);
    setSnapshot({ ...currentSnapshot });
    setDepth(currentSnapshot.depth ?? 0);
    setLocalStatus('saved');
    setAllTags([...new Set([...snapshots].reverse().flatMap((item) => item.tags))]);
  }

  function waitForPermissionExplanation(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  async function saveTags(tags: string[]) {
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot, snapshots } = await getCurrentSnapshot(nextActivePage);
    currentSnapshot.tags = tags;
    currentSnapshot.depth = depth;
    await setSnapshots(snapshots);
    setSnapshot({ ...currentSnapshot });
    setLocalStatus('saved');
    await sendToArchiveBox(currentSnapshot.url, tags, depth);
  }

  async function saveDepth(nextDepth: ArchiveDepth) {
    setCrawlMenuOpen(false);
    setDepth(nextDepth);
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot, snapshots } = await getCurrentSnapshot(nextActivePage);
    currentSnapshot.depth = nextDepth;
    await setSnapshots(snapshots);
    setSnapshot({ ...currentSnapshot });
    setLocalStatus('saved');
    await sendToArchiveBox(currentSnapshot.url, currentSnapshot.tags, nextDepth);
  }

  async function sendToArchiveBox(url: string, tags: string[], archiveDepth: ArchiveDepth) {
    setRemoteStatus('not_archived');
    setRemoteDetail('');
    setStatus(t("ArchiveBox needs permission to connect to your configured server so it can upload this URL."));
    await waitForPermissionExplanation();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'archivebox_add',
      body: { urls: [url], tags, depth: archiveDepth },
    });
    if (response.ok) {
      setOk(true);
      setRemoteStatus('archived');
      setRemoteDetail('');
      setStatus(t("Saved to ArchiveBox Server at depth $1", archiveDepth));
    } else {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(t("Saved locally. Failed to archive on server: $1", errorMessage));
    }
  }

  useEffect(() => {
    getConfig()
      .then(({ ui_language }) => setUiLanguage(ui_language))
      .catch(() => undefined)
      .then(refresh);
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (snapshot) sendToArchiveBox(snapshot.url, snapshot.tags, snapshot.depth ?? 0);
  }, [snapshot?.id]);

  useEffect(() => {
    setFaviconFailed(false);
  }, [snapshot?.url, snapshot?.favIconUrl]);

  const suggestions = useMemo(() => {
    if (!snapshot || localStatus === 'removed') return [];
    return [
      '⭐️',
      activePage ? new URL(activePage.url).hostname.replace(/^www\./, '').replace(/\.com$/, '') : '',
      ...allTags,
    ]
      .filter(Boolean)
      .filter((tag, index, list) => list.indexOf(tag) === index)
      .filter((tag) => !snapshot.tags.includes(tag))
      .slice(0, 6);
  }, [activePage, allTags, localStatus, snapshot]);

  const filteredSuggestions = useMemo(() => {
    return matchingTagSuggestions(allTags, input, snapshot?.tags || []);
  }, [allTags, input, snapshot]);

  function close() {
    window.close();
  }

  function openOptions(id?: string) {
    browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_options',
      id,
    });
  }

  function openCurrentSnapshotInOptions() {
    if (!snapshot?.id) return;
    openOptions(snapshot.id);
  }

  async function removeLocalSnapshot() {
    if (!activePage) return;
    setInput('');
    setCrawlMenuOpen(false);
    setSnapshot((current) => current ? { ...current, tags: [] } : unsavedSnapshot(activePage));
    setAllTags([]);
    setLocalStatus('removed');
    setOk(null);
    setStatus(t("Removed from local saved URLs"));
    const snapshots = await getSnapshots();
    await setSnapshots(snapshots.filter((item) => item.url !== activePage.url));
    setIsFadingOut(true);
    window.setTimeout(close, 450);
  }

  async function removeRemoteSnapshot() {
    if (!snapshot || !confirm(t("Remove this URL from the ArchiveBox server?"))) return;
    setStatus(t("ArchiveBox needs permission to connect to your configured server so it can remove this URL."));
    await waitForPermissionExplanation();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'archivebox_remove',
      url: snapshot.url,
    });
    if (response.ok) {
      setOk(null);
      setRemoteStatus('not_archived');
      setRemoteDetail('');
      setStatus(t("Removed from ArchiveBox Server"));
    } else {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to remove from server: $1", errorMessage));
    }
  }

  async function viewRemoteSnapshot() {
    if (!snapshot) return;
    setStatus(t("ArchiveBox needs permission to connect to your configured server so it can open the archived copy."));
    await waitForPermissionExplanation();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_archivebox_snapshot',
      url: snapshot.url,
    });
    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to open archived copy: $1", errorMessage));
    }
  }

  function openCaptureView(view: 'screenshot' | 'mhtml' | 'singlefile') {
    if (!snapshot?.id) return;
    browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_options',
      id: snapshot.id,
      view,
    });
  }

  async function ensureMhtmlPermission(): Promise<boolean> {
    setOk(null);
    setStatus(t("MHTML capture needs permission to save the current tab as a browser-generated MHTML file."));
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['pageCapture'] }).catch(() => false);
    if (!granted) {
      setOk(false);
      setStatus(t("MHTML capture permission denied"));
      return false;
    }
    return true;
  }

  async function requestScreenshotScrollPermission(): Promise<boolean> {
    setOk(null);
    setStatus(t("Full-page screenshots need scripting permission only to scroll the current tab and restore it after capture."));
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['scripting'] }).catch(() => false);
    if (!granted) {
      setOk(null);
      setStatus(t("Saved visible-area screenshot. Full-page scrolling permission denied."));
      return false;
    }
    return true;
  }

  async function screenshotNeedsScrolling(activePageForCapture: ActivePage): Promise<boolean | null> {
    let response: RuntimeResponse;
    try {
      response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
        type: 'measure_screenshot_page',
        tabId: activePageForCapture.tabId,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    return Boolean(response.screenshotNeedsScroll);
  }

  async function ensureLocalCaptureStoragePermission(): Promise<boolean> {
    const storageManager = navigator.storage as StorageManager & {
      persist?: () => Promise<boolean>;
    };
    await storageManager.persist?.().catch(() => false);
    try {
      await assertLocalCaptureStorageAvailable();
    } catch (error) {
      setOk(false);
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
    return true;
  }

  async function cancelScreenshotCapture() {
    const snapshotId = screenshotCapture.snapshotId || snapshot?.id;
    if (!snapshotId) return;
    setScreenshotCapture((current) => ({
      ...current,
      phase: 'canceling',
    }));
    setStatus(t("Canceling screenshot capture..."));
    await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'cancel_snapshot_screenshot',
      snapshotId,
    }).catch(() => undefined);
  }

  useEffect(() => {
    if (screenshotCapture.phase !== 'capturing') return undefined;

    const scrollCancelWindowMs = 1200;
    const scrollCancelDelta = 900;
    const scrollCancelEvents = 4;
    const keyCancelWindowMs = 1200;
    const keyCancelEvents = 2;
    let cancelRequested = false;
    let scrollStartedAt = 0;
    let scrollDelta = 0;
    let scrollEvents = 0;
    let keyStartedAt = 0;
    let keyEvents = 0;

    function eventTargetIsEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName.toLowerCase();
      return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    }

    function requestCancel(): void {
      if (cancelRequested) return;
      cancelRequested = true;
      void cancelScreenshotCapture();
    }

    function recordScroll(delta: number): void {
      const now = Date.now();
      if (!scrollStartedAt || now - scrollStartedAt > scrollCancelWindowMs) {
        scrollStartedAt = now;
        scrollDelta = 0;
        scrollEvents = 0;
      }
      scrollDelta += Math.abs(delta);
      scrollEvents += 1;
      if (scrollDelta >= scrollCancelDelta || scrollEvents >= scrollCancelEvents) {
        requestCancel();
      }
    }

    function handleWheel(event: WheelEvent): void {
      recordScroll(Math.abs(event.deltaY) + Math.abs(event.deltaX));
    }

    function handleTouchMove(): void {
      recordScroll(300);
    }

    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' || eventTargetIsEditable(event.target)) {
        requestCancel();
        return;
      }

      const now = Date.now();
      if (!keyStartedAt || now - keyStartedAt > keyCancelWindowMs) {
        keyStartedAt = now;
        keyEvents = 0;
      }
      keyEvents += 1;
      if (keyEvents >= keyCancelEvents) {
        requestCancel();
      }
    }

    window.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      window.removeEventListener('keydown', handleKey, { capture: true });
    };
  }, [screenshotCapture.phase, screenshotCapture.snapshotId, snapshot?.id]);

  async function captureLocalArtifact(kind: 'screenshot' | 'mhtml' | 'singlefile') {
    if (kind === 'screenshot' && (screenshotCapture.phase === 'capturing' || screenshotCapture.phase === 'canceling')) {
      await cancelScreenshotCapture();
      return;
    }

    setStatusLink(null);
    if (kind === 'mhtml' && !supportsMhtmlCapture) {
      setOk(false);
      setStatus(mhtmlUnsupportedMessage());
      return;
    }
    if (kind === 'mhtml' && !(await ensureMhtmlPermission())) return;

    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot } = await getCurrentSnapshot(nextActivePage);
    if (kind === 'screenshot' && currentSnapshot.screenshot) {
      openCaptureView('screenshot');
      return;
    }
    if (kind === 'mhtml' && currentSnapshot.mhtml) {
      openCaptureView('mhtml');
      return;
    }
    if (kind === 'singlefile' && currentSnapshot.singlefile) {
      openCaptureView('singlefile');
      return;
    }

    if (!(await ensureLocalCaptureStoragePermission())) return;
    if (kind === 'screenshot') {
      const visibleLabel = t("visible-area screenshot");
      setStatus(t("Saving local $1...", visibleLabel));
      setOk(null);
      setScreenshotCapture({
        phase: 'visible',
        snapshotId: currentSnapshot.id,
        captured: 0,
        total: 1,
      });
      const visibleResponse = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
        type: 'capture_snapshot_screenshot',
        snapshotId: currentSnapshot.id,
        tabId: nextActivePage.tabId,
        windowId: nextActivePage.windowId,
        fullPage: false,
      });

      if (!visibleResponse.ok) {
        const errorMessage = visibleResponse.errorMessage || visibleResponse.error || t("Unknown error");
        setOk(false);
        setStatus(t("Failed to save local $1: $2", visibleLabel, errorMessage));
        await refresh();
        return;
      }

      let snapshots = await getSnapshots();
      let nextSnapshot = snapshots.find((item) => item.id === currentSnapshot.id) || currentSnapshot;
      setSnapshot({ ...nextSnapshot });
      setLocalStatus('saved');
      setOk(true);
      setStatus(t("Saved local $1", visibleLabel));
      setScreenshotCapture({
        phase: 'visible',
        snapshotId: currentSnapshot.id,
        captured: 1,
        total: 1,
      });

      let hasScrollPermission = await browser.permissions.contains({ permissions: ['scripting'] }).catch(() => false);
      if (!hasScrollPermission) {
        hasScrollPermission = await requestScreenshotScrollPermission();
      }
      if (!hasScrollPermission) {
        setScreenshotCapture({ phase: 'idle', captured: 0, total: 0 });
        return;
      }

      const needsScroll = await screenshotNeedsScrolling(nextActivePage);
      if (!needsScroll) {
        setOk(true);
        setStatus(t("Saved local $1", t("screenshot")));
        setScreenshotCapture({ phase: 'idle', captured: 0, total: 0 });
        return;
      }

      const artifactLabel = t("screenshot");
      setStatus(t("Saving local $1...", artifactLabel));
      setOk(null);
      setScreenshotCapture({
        phase: 'capturing',
        snapshotId: currentSnapshot.id,
        captured: 1,
        total: 2,
      });
      const fullPageResponse = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
        type: 'capture_snapshot_screenshot',
        snapshotId: currentSnapshot.id,
        tabId: nextActivePage.tabId,
        windowId: nextActivePage.windowId,
        fullPage: true,
      });

      snapshots = await getSnapshots();
      nextSnapshot = snapshots.find((item) => item.id === currentSnapshot.id) || currentSnapshot;
      setSnapshot({ ...nextSnapshot });
      setLocalStatus('saved');
      if (!fullPageResponse.ok) {
        const errorMessage = fullPageResponse.errorMessage || fullPageResponse.error || t("Unknown error");
        setOk(false);
        setStatus(t("Saved visible-area screenshot. Failed to save full-page screenshot: $1", errorMessage));
        setScreenshotCapture({ phase: 'idle', captured: 0, total: 0 });
        return;
      }

      setOk(true);
      setStatus(fullPageResponse.screenshotCanceled
        ? t("Saved partial local $1", artifactLabel)
        : t("Saved local $1", artifactLabel));
      setScreenshotCapture({ phase: 'idle', captured: 0, total: 0 });
      return;
    }
    const artifactLabel = kind === 'mhtml' ? t("MHTML snapshot") : t("SingleFile HTML");
    setStatus(t("Saving local $1...", artifactLabel));
    setOk(null);
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: kind === 'mhtml'
          ? 'capture_snapshot_mhtml'
          : 'capture_snapshot_singlefile',
      snapshotId: currentSnapshot.id,
      tabId: nextActivePage.tabId,
      windowId: nextActivePage.windowId,
    });

    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      if (kind === 'singlefile') {
        const installMessage = t("Make sure you have SingleFile installed.");
        setStatus(installMessage);
        setStatusLink({
          href: singleFileChromeWebStoreUrl,
          label: t("Install SingleFile from the Chrome Web Store"),
          status: installMessage,
        });
      } else {
        setStatus(t("Failed to save local $1: $2", artifactLabel, errorMessage));
      }
      await refresh();
      return;
    }

    const snapshots = await getSnapshots();
    const nextSnapshot = snapshots.find((item) => item.id === currentSnapshot.id) || currentSnapshot;
    setSnapshot({ ...nextSnapshot });
    setLocalStatus('saved');
    setOk(true);
    setStatus(t("Saved local $1", artifactLabel));
  }

  async function addTag(tag: string) {
    if (!snapshot || snapshot.tags.includes(tag)) return;
    setInput('');
    await saveTags([...snapshot.tags, tag]);
    await refresh();
  }

  async function removeTag(tag: string) {
    if (!snapshot) return;
    await saveTags(snapshot.tags.filter((currentTag) => currentTag !== tag));
    await refresh();
  }

  const pageTitle = snapshot?.title || activePage?.title || t("Untitled page");
  const pageUrl = snapshot?.url || activePage?.url || '';
  const pageFavicon = snapshot?.favIconUrl || activePage?.favIconUrl || null;
  const showPageFavicon = Boolean(pageFavicon && !faviconFailed);
  const depthOptions = crawlDepthOptions();
  const currentDepthLabel = depthOptions.find((option) => option.value === depth)?.label || t("Depth 0: just this page");
  const crawlButtonLabel = depth === 0 ? t("Crawl") : t("Crawl Depth: $1", depth);
  const screenshotCaptureActive = screenshotCapture.phase === 'capturing' || screenshotCapture.phase === 'canceling';
  const screenshotCaptureVisible = screenshotCapture.phase === 'visible';
  const screenshotButtonClass = [
    'archivebox-overlay__capture-button',
    snapshot?.screenshot || screenshotCaptureVisible ? 'archivebox-overlay__capture-button--saved' : '',
    screenshotCaptureActive ? 'archivebox-overlay__capture-button--capturing' : '',
  ].filter(Boolean).join(' ');
  const savedScreenshotCount = Math.max(1, snapshot?.screenshot?.parts?.length || 0);
  const screenshotButtonLabel = screenshotCaptureActive
    ? t("Stop $1/$2", screenshotCapture.captured, screenshotCapture.total || screenshotCapture.captured)
    : screenshotCaptureVisible && screenshotCapture.captured > 0
      ? `✓ ${t("Screenshot")} ${screenshotCapture.captured}/${screenshotCapture.total}`
      : snapshot?.screenshot
        ? `✓ ${t("Screenshot")} ${savedScreenshotCount}`
        : t("Screenshot");

  return (
    <section className={`archivebox-overlay${isFadingOut ? ' archivebox-overlay--leaving' : ''}`} aria-label={t("ArchiveBox save panel")}>
      <button className="archivebox-overlay__settings" onClick={() => openOptions()} title={t("Open options")}>
        ⚙
      </button>
      <button className="archivebox-overlay__close" onClick={close} title={t("Close")}>
        ×
      </button>
      <div className="archivebox-overlay__page">
        <button className="archivebox-overlay__page-link archivebox-overlay__page-link--favicon" onClick={openCurrentSnapshotInOptions} title={t("Show this URL in Saved URLs")}>
          {showPageFavicon ? (
            <img src={pageFavicon || ''} alt="" onError={() => setFaviconFailed(true)} />
          ) : (
            <span className="archivebox-overlay__favicon-placeholder" aria-hidden="true" />
          )}
        </button>
        <div>
          <button className="archivebox-overlay__page-link archivebox-overlay__page-title" onClick={openCurrentSnapshotInOptions} title={t("Show this URL in Saved URLs")}>
            <strong>{pageTitle}</strong>
            <code>{pageUrl}</code>
          </button>
          <TagList className="archivebox-overlay__page-tags">
            {snapshot?.tags.map((tag) => (
              <TagChip key={tag} label={tag} onRemove={() => removeTag(tag)} removeTitle={t("Remove tag $1", tag)} />
            ))}
            {suggestions.map((tag) => (
              <TagChip key={tag} label={tag} suffix="+" variant="suggestion" onClick={() => addTag(tag)} />
            ))}
            {localStatus !== 'removed' && (
              <TagInputChip
                value={input}
                placeholder={t("+ tag")}
                suggestions={filteredSuggestions}
                onCommit={addTag}
                onCancel={close}
                onChange={setInput}
                autoFocus
              />
            )}
          </TagList>
        </div>
      </div>

      <div className="archivebox-overlay__header">
        <div className="archivebox-overlay__capture-actions">
          <button
            className={screenshotButtonClass}
            onClick={() => captureLocalArtifact('screenshot')}
            title={screenshotCaptureActive
              ? t("Cancel full-page screenshot capture and restore scroll position")
              : snapshot?.screenshot
                ? t("Open saved screenshot")
                : t("Save a screenshot for this URL. Full-page scrolling may ask for optional scripting permission; denying it saves the visible area.")}
          >
            {screenshotButtonLabel}
          </button>
          {supportsMhtmlCapture ? (
            <button
              className={`archivebox-overlay__capture-button${snapshot?.mhtml ? ' archivebox-overlay__capture-button--saved' : ''}`}
              onClick={() => captureLocalArtifact('mhtml')}
              title={snapshot?.mhtml ? t("Open saved MHTML snapshot") : t("Save an MHTML snapshot for this URL")}
            >
              {snapshot?.mhtml ? `✓ ${t("MHTML")}` : t("MHTML")}
            </button>
          ) : (
            <button
              className="archivebox-overlay__capture-button archivebox-overlay__capture-button--disabled"
              onClick={() => captureLocalArtifact('mhtml')}
              title={mhtmlUnsupportedMessage()}
            >
              {t("MHTML unavailable")}
            </button>
          )}
          <button
            className={`archivebox-overlay__capture-button${snapshot?.singlefile ? ' archivebox-overlay__capture-button--saved' : ''}`}
            onClick={() => captureLocalArtifact('singlefile')}
            title={snapshot?.singlefile ? t("Open saved SingleFile HTML snapshot") : singleFileCaptureUnavailableMessage()}
          >
            {snapshot?.singlefile ? `✓ ${t("SingleFile")}` : t("SingleFile")}
          </button>
        </div>
        <div className="archivebox-overlay__crawl">
          <button
            className="archivebox-overlay__crawl-button"
            title={currentDepthLabel}
            onClick={() => setCrawlMenuOpen((open) => !open)}
          >
            {crawlButtonLabel}
          </button>
          {crawlMenuOpen && (
            <div className="archivebox-overlay__crawl-menu" role="menu">
              {depthOptions.map((option) => (
                <button
                  key={option.value}
                  className={option.value === depth ? 'selected' : ''}
                  role="menuitem"
                  onClick={() => saveDepth(toArchiveDepth(option.value))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="archivebox-overlay__states" aria-label={t("Archive status")}>
        <div className="archivebox-overlay__state-row">
          <span className="archivebox-overlay__state-label">{t("Local")}</span>
          <span className={`archivebox-overlay__pill archivebox-overlay__pill--${localStatus}`}>
            {localStatus === 'saved' ? t("Saved") : localStatus === 'removed' ? t("Removed") : t("Unsaved")}
          </span>
          <button className="archivebox-overlay__action" onClick={removeLocalSnapshot} disabled={localStatus !== 'saved'} title={t("Remove from local saved URLs")}>
            🗑
          </button>
          <button className="archivebox-overlay__action" onClick={openCurrentSnapshotInOptions} disabled={localStatus !== 'saved'} title={t("Show in Saved URLs")}>
            👁
          </button>
        </div>
        <div className={`archivebox-overlay__state-row${remoteStatus === 'server_not_connected' ? ' archivebox-overlay__state-row--status-only' : ''}`}>
          <span className="archivebox-overlay__state-label">{t("Server")}</span>
          <span
            className={`archivebox-overlay__pill archivebox-overlay__pill--${remoteStatus}`}
            title={remoteDetail || undefined}
          >
            {remoteStatus === 'archived'
              ? t("Archived")
              : remoteStatus === 'server_not_connected'
                ? t("Server not connected")
                : t("Not yet archived")}
          </span>
          {remoteStatus !== 'server_not_connected' && (
            <>
              <button className="archivebox-overlay__action" onClick={removeRemoteSnapshot} disabled={remoteStatus !== 'archived'} title={t("Remove from ArchiveBox server")}>
                🗑
              </button>
              <button className="archivebox-overlay__action" onClick={viewRemoteSnapshot} disabled={remoteStatus !== 'archived'} title={t("View archived copy on server")}>
                👁
              </button>
            </>
          )}
        </div>
      </div>

      <small className={ok === false ? 'archivebox-overlay__status archivebox-overlay__status--error' : 'archivebox-overlay__status'}>
        <span />
        {status}
        {statusLink?.status === status ? (
          <a href={statusLink.href} target="_blank" rel="noreferrer">
            {statusLink.label}
          </a>
        ) : null}
      </small>
    </section>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ArchiveBoxOverlay />
  </React.StrictMode>,
);
