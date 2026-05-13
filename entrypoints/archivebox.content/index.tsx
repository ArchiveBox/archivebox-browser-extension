import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { mhtmlUnsupportedMessage, singleFileCaptureUnavailableMessage, supportsMhtmlCapture } from '@/src/lib/browserCapabilities';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { createSnapshot } from '@/src/lib/snapshots';
import { getConfig, getSnapshots, setSnapshots } from '@/src/lib/storage';
import { matchingTagSuggestions } from '@/src/lib/tags';
import type { ArchiveDepth, RuntimeMessage, RuntimeResponse, Snapshot } from '@/src/lib/types';
import './style.css';

let root: ReactDOM.Root | null = null;
let host: HTMLDivElement | null = null;
let overlayUi: ShadowRootContentScriptUi<ReactDOM.Root> | null = null;
let contentScriptContext: ContentScriptContext;
const testBridgeEnabled = new URLSearchParams(window.location.search).has('archivebox_test');
type RemoteArchiveStatus = 'not_archived' | 'archived' | 'server_not_connected';
type LocalArchiveStatus = 'saved' | 'unsaved' | 'removed';

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

function getPageFaviconUrl(): string | null {
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]');
  if (icon?.href) return icon.href;
  return null;
}

function toArchiveDepth(value: number): ArchiveDepth {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  return 4;
}

async function getCurrentSnapshot(): Promise<{
  currentSnapshot: Snapshot;
  snapshots: Snapshot[];
  created: boolean;
}> {
  const snapshots = await getSnapshots();
  const pageUrl = window.location.href;
  let currentSnapshot = snapshots.find((snapshot) => snapshot.url === pageUrl);
  let created = false;

  if (!currentSnapshot) {
    currentSnapshot = createSnapshot(pageUrl, [], document.title, getPageFaviconUrl());
    snapshots.push(currentSnapshot);
    await setSnapshots(snapshots);
    created = true;
  } else {
    currentSnapshot.title = currentSnapshot.title || document.title;
    currentSnapshot.favIconUrl = currentSnapshot.favIconUrl || getPageFaviconUrl();
  }

  return { currentSnapshot, snapshots, created };
}

function unsavedSnapshot(): Snapshot {
  return createSnapshot(window.location.href, [], document.title, getPageFaviconUrl());
}

function setOverlayHiddenForCapture(hidden: boolean) {
  overlayUi?.shadowHost.classList.toggle('archivebox-extension-root--capturing', hidden);
}

async function waitForOverlayHiddenForCapture() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  host?.getBoundingClientRect();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function ArchiveBoxOverlay() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(t("Saved locally..."));
  const [ok, setOk] = useState<boolean | null>(null);
  const [depth, setDepth] = useState<ArchiveDepth>(0);
  const [localStatus, setLocalStatus] = useState<LocalArchiveStatus>('unsaved');
  const [remoteStatus, setRemoteStatus] = useState<RemoteArchiveStatus>('not_archived');
  const [remoteDetail, setRemoteDetail] = useState('');
  const [crawlMenuOpen, setCrawlMenuOpen] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  async function refresh() {
    const { currentSnapshot, snapshots } = await getCurrentSnapshot();
    setSnapshot({ ...currentSnapshot });
    setDepth(currentSnapshot.depth ?? 0);
    setLocalStatus('saved');
    setAllTags([...new Set([...snapshots].reverse().flatMap((item) => item.tags))]);
  }

  async function saveTags(tags: string[]) {
    const { currentSnapshot, snapshots } = await getCurrentSnapshot();
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
    const { currentSnapshot, snapshots } = await getCurrentSnapshot();
    currentSnapshot.depth = nextDepth;
    await setSnapshots(snapshots);
    setSnapshot({ ...currentSnapshot });
    setLocalStatus('saved');
    await sendToArchiveBox(currentSnapshot.url, currentSnapshot.tags, nextDepth);
  }

  async function sendToArchiveBox(url: string, tags: string[], archiveDepth: ArchiveDepth) {
    setRemoteStatus('not_archived');
    setRemoteDetail('');
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
    refresh();
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
      window.location.hostname.replace(/^www\./, '').replace(/\.com$/, ''),
      ...allTags,
    ]
      .filter(Boolean)
      .filter((tag, index, list) => list.indexOf(tag) === index)
      .filter((tag) => !snapshot.tags.includes(tag))
      .slice(0, 6);
  }, [allTags, localStatus, snapshot]);

  const filteredSuggestions = useMemo(() => {
    return matchingTagSuggestions(allTags, input, snapshot?.tags || []);
  }, [allTags, input, snapshot]);

  function close() {
    root?.unmount();
    root = null;
    overlayUi?.remove();
    overlayUi = null;
    host = null;
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
    setInput('');
    setCrawlMenuOpen(false);
    setSnapshot((current) => current ? { ...current, tags: [] } : unsavedSnapshot());
    setAllTags([]);
    setLocalStatus('removed');
    setOk(null);
    setStatus(t("Removed from local saved URLs"));
    const snapshots = await getSnapshots();
    await setSnapshots(snapshots.filter((item) => item.url !== window.location.href));
    setIsFadingOut(true);
    window.setTimeout(close, 450);
  }

  async function removeRemoteSnapshot() {
    if (!snapshot || !confirm(t("Remove this URL from the ArchiveBox server?"))) return;
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

  async function captureLocalArtifact(kind: 'screenshot' | 'mhtml' | 'singlefile') {
    if (kind === 'mhtml' && !supportsMhtmlCapture) {
      setOk(false);
      setStatus(mhtmlUnsupportedMessage());
      return;
    }

    const { currentSnapshot } = await getCurrentSnapshot();
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

    const artifactLabel = kind === 'screenshot' ? t("screenshot") : kind === 'mhtml' ? t("MHTML snapshot") : t("SingleFile HTML");
    setStatus(t("Saving local $1...", artifactLabel));
    setOk(null);
    setOverlayHiddenForCapture(true);
    await waitForOverlayHiddenForCapture();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: kind === 'screenshot'
        ? 'capture_snapshot_screenshot'
        : kind === 'mhtml'
          ? 'capture_snapshot_mhtml'
          : 'capture_snapshot_singlefile',
      snapshotId: currentSnapshot.id,
    }).finally(() => setOverlayHiddenForCapture(false));

    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setStatus(t("Failed to save local $1: $2", artifactLabel, errorMessage));
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

  const pageTitle = snapshot?.title || document.title || t("Untitled page");
  const pageUrl = snapshot?.url || window.location.href;
  const pageFavicon = snapshot?.favIconUrl || getPageFaviconUrl();
  const showPageFavicon = Boolean(pageFavicon && !faviconFailed);
  const depthOptions = crawlDepthOptions();
  const currentDepthLabel = depthOptions.find((option) => option.value === depth)?.label || t("Depth 0: just this page");
  const crawlButtonLabel = depth === 0 ? t("Crawl") : t("Crawl Depth: $1", depth);

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
            className={`archivebox-overlay__capture-button${snapshot?.screenshot ? ' archivebox-overlay__capture-button--saved' : ''}`}
            onClick={() => captureLocalArtifact('screenshot')}
            title={snapshot?.screenshot ? t("Open saved screenshot") : t("Save a screenshot for this URL")}
          >
            {snapshot?.screenshot ? `✓ ${t("Screenshot")}` : t("Screenshot")}
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
      </small>
    </section>
  );
}

async function showOverlay() {
  await getConfig()
    .then(({ ui_language }) => setUiLanguage(ui_language))
    .catch(() => undefined);
  if (overlayUi) {
    overlayUi.remove();
    overlayUi = null;
    host = null;
  }
  overlayUi = await createShadowRootUi<ReactDOM.Root>(contentScriptContext, {
    name: 'archivebox-extension-root',
    mode: testBridgeEnabled ? 'open' : 'closed',
    position: 'inline',
    anchor: () => document.documentElement,
    append: (_anchor, ui) => document.documentElement.appendChild(ui),
    onMount: (container, _shadow, shadowHost) => {
      shadowHost.id = 'archivebox-extension-root';
      host = container as HTMLDivElement;
      root = ReactDOM.createRoot(container);
      root.render(<ArchiveBoxOverlay />);
      return root;
    },
    onRemove: (mountedRoot) => {
      mountedRoot?.unmount();
      if (root === mountedRoot) root = null;
      host = null;
    },
  });
  overlayUi.mount();
}

function pageMetrics() {
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
}

async function waitForScrollSettle() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function scrollForScreenshot(x: number, y: number) {
  window.scrollTo(x, y);
  await waitForScrollSettle();
  return {
    ...pageMetrics(),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

declare global {
  interface Window {
    __archiveboxContentScriptInstalled?: boolean;
  }
}

export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'ui',
  main(ctx) {
    contentScriptContext = ctx;
    if (window.__archiveboxContentScriptInstalled) return;
    window.__archiveboxContentScriptInstalled = true;

    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      switch (message.type) {
        case 'hide_archivebox_overlay':
          close();
          return Promise.resolve({ ok: true });

        case 'show_archivebox_overlay':
          return showOverlay().then(() => ({ ok: true }));

        case 'screenshot_get_metrics':
          return Promise.resolve(pageMetrics());

        case 'screenshot_scroll':
          return scrollForScreenshot(message.x, message.y);

        case 'screenshot_restore_scroll':
          return scrollForScreenshot(message.x, message.y).then(() => ({ ok: true }));

        default:
          break;
      }
    });
  },
});
