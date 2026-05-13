import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { createSnapshot } from '@/src/lib/snapshots';
import { getSnapshots, setSnapshots } from '@/src/lib/storage';
import { matchingTagSuggestions } from '@/src/lib/tags';
import type { ArchiveDepth, RuntimeMessage, RuntimeResponse, Snapshot } from '@/src/lib/types';
import './style.css';

let root: ReactDOM.Root | null = null;
let host: HTMLDivElement | null = null;
type RemoteArchiveStatus = 'not_archived' | 'archived' | 'server_not_connected';
type LocalArchiveStatus = 'saved' | 'unsaved' | 'removed';

const crawlDepthOptions: Array<{
  value: ArchiveDepth;
  label: string;
}> = [
  { value: 0, label: 'Depth 0: just this page' },
  { value: 1, label: 'Depth 1: linked pages within' },
  { value: 2, label: 'Depth 2: links two hops out' },
  { value: 3, label: 'Depth 3: links three hops out' },
  { value: 4, label: 'Depth 4: maximum allowed' },
];

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
  host?.classList.toggle('archivebox-extension-root--capturing', hidden);
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
  const [status, setStatus] = useState('Saved locally...');
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
      setStatus(`Saved to ArchiveBox Server at depth ${archiveDepth}`);
    } else {
      const errorMessage = response.errorMessage || response.error || 'Unknown error';
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(`Saved locally. Failed to archive on server: ${errorMessage}`);
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
    host?.remove();
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
    setStatus('Removed from local saved URLs');
    const snapshots = await getSnapshots();
    await setSnapshots(snapshots.filter((item) => item.url !== window.location.href));
    setIsFadingOut(true);
    window.setTimeout(close, 450);
  }

  async function removeRemoteSnapshot() {
    if (!snapshot || !confirm('Remove this URL from the ArchiveBox server?')) return;
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'archivebox_remove',
      url: snapshot.url,
    });
    if (response.ok) {
      setOk(null);
      setRemoteStatus('not_archived');
      setRemoteDetail('');
      setStatus('Removed from ArchiveBox Server');
    } else {
      const errorMessage = response.errorMessage || response.error || 'Unknown error';
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(`Failed to remove from server: ${errorMessage}`);
    }
  }

  async function viewRemoteSnapshot() {
    if (!snapshot) return;
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_archivebox_snapshot',
      url: snapshot.url,
    });
    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || 'Unknown error';
      setOk(false);
      setRemoteStatus('server_not_connected');
      setRemoteDetail(errorMessage);
      setStatus(`Failed to open archived copy: ${errorMessage}`);
    }
  }

  function openCaptureView(view: 'screenshot' | 'mhtml') {
    if (!snapshot?.id) return;
    browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_options',
      id: snapshot.id,
      view,
    });
  }

  async function captureLocalArtifact(kind: 'screenshot' | 'mhtml') {
    const { currentSnapshot } = await getCurrentSnapshot();
    if (kind === 'screenshot' && currentSnapshot.screenshot) {
      openCaptureView('screenshot');
      return;
    }
    if (kind === 'mhtml' && currentSnapshot.mhtml) {
      openCaptureView('mhtml');
      return;
    }

    setStatus(`Saving local ${kind === 'screenshot' ? 'screenshot' : 'MHTML snapshot'}...`);
    setOk(null);
    setOverlayHiddenForCapture(true);
    await waitForOverlayHiddenForCapture();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: kind === 'screenshot' ? 'capture_snapshot_screenshot' : 'capture_snapshot_mhtml',
      snapshotId: currentSnapshot.id,
    }).finally(() => setOverlayHiddenForCapture(false));

    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || 'Unknown error';
      setOk(false);
      setStatus(`Failed to save local ${kind === 'screenshot' ? 'screenshot' : 'MHTML snapshot'}: ${errorMessage}`);
      await refresh();
      return;
    }

    const snapshots = await getSnapshots();
    const nextSnapshot = snapshots.find((item) => item.id === currentSnapshot.id) || currentSnapshot;
    setSnapshot({ ...nextSnapshot });
    setLocalStatus('saved');
    setOk(true);
    setStatus(`Saved local ${kind === 'screenshot' ? 'screenshot' : 'MHTML snapshot'}`);
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

  const pageTitle = snapshot?.title || document.title || 'Untitled page';
  const pageUrl = snapshot?.url || window.location.href;
  const pageFavicon = snapshot?.favIconUrl || getPageFaviconUrl();
  const showPageFavicon = Boolean(pageFavicon && !faviconFailed);
  const currentDepthLabel = crawlDepthOptions.find((option) => option.value === depth)?.label || 'Depth 0: just this page';
  const crawlButtonLabel = depth === 0 ? 'Crawl' : `Crawl Depth: ${depth}`;

  return (
    <section className={`archivebox-overlay${isFadingOut ? ' archivebox-overlay--leaving' : ''}`} aria-label="ArchiveBox save panel">
      <button className="archivebox-overlay__settings" onClick={() => openOptions()} title="Open options">
        ⚙
      </button>
      <button className="archivebox-overlay__close" onClick={close} title="Close">
        ×
      </button>
      <div className="archivebox-overlay__page">
        <button className="archivebox-overlay__page-link archivebox-overlay__page-link--favicon" onClick={openCurrentSnapshotInOptions} title="Show this URL in Saved URLs">
          {showPageFavicon ? (
            <img src={pageFavicon || ''} alt="" onError={() => setFaviconFailed(true)} />
          ) : (
            <span className="archivebox-overlay__favicon-placeholder" aria-hidden="true" />
          )}
        </button>
        <div>
          <button className="archivebox-overlay__page-link archivebox-overlay__page-title" onClick={openCurrentSnapshotInOptions} title="Show this URL in Saved URLs">
            <strong>{pageTitle}</strong>
            <code>{pageUrl}</code>
          </button>
          <TagList className="archivebox-overlay__page-tags">
            {snapshot?.tags.map((tag) => (
              <TagChip key={tag} label={tag} onRemove={() => removeTag(tag)} removeTitle={`Remove tag ${tag}`} />
            ))}
            {suggestions.map((tag) => (
              <TagChip key={tag} label={tag} suffix="+" variant="suggestion" onClick={() => addTag(tag)} />
            ))}
            {localStatus !== 'removed' && (
              <TagInputChip
                value={input}
                placeholder="+ tag"
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
            title={snapshot?.screenshot ? 'Open saved screenshot' : 'Save a screenshot for this URL'}
          >
            {snapshot?.screenshot ? '✓ Screenshot' : 'Screenshot'}
          </button>
          <button
            className={`archivebox-overlay__capture-button${snapshot?.mhtml ? ' archivebox-overlay__capture-button--saved' : ''}`}
            onClick={() => captureLocalArtifact('mhtml')}
            title={snapshot?.mhtml ? 'Open saved MHTML snapshot' : 'Save an MHTML snapshot for this URL'}
          >
            {snapshot?.mhtml ? '✓ MHTML' : 'MHTML'}
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
              {crawlDepthOptions.map((option) => (
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

      <div className="archivebox-overlay__states" aria-label="Archive status">
        <div className="archivebox-overlay__state-row">
          <span className="archivebox-overlay__state-label">Local</span>
          <span className={`archivebox-overlay__pill archivebox-overlay__pill--${localStatus}`}>
            {localStatus === 'saved' ? 'Saved' : localStatus === 'removed' ? 'Removed' : 'Unsaved'}
          </span>
          <button className="archivebox-overlay__action" onClick={removeLocalSnapshot} disabled={localStatus !== 'saved'} title="Remove from local saved URLs">
            🗑
          </button>
          <button className="archivebox-overlay__action" onClick={openCurrentSnapshotInOptions} disabled={localStatus !== 'saved'} title="Show in Saved URLs">
            👁
          </button>
        </div>
        <div className={`archivebox-overlay__state-row${remoteStatus === 'server_not_connected' ? ' archivebox-overlay__state-row--status-only' : ''}`}>
          <span className="archivebox-overlay__state-label">Server</span>
          <span
            className={`archivebox-overlay__pill archivebox-overlay__pill--${remoteStatus}`}
            title={remoteDetail || undefined}
          >
            {remoteStatus === 'archived'
              ? 'Archived'
              : remoteStatus === 'server_not_connected'
                ? 'Server not connected'
                : 'Not yet archived'}
          </span>
          {remoteStatus !== 'server_not_connected' && (
            <>
              <button className="archivebox-overlay__action" onClick={removeRemoteSnapshot} disabled={remoteStatus !== 'archived'} title="Remove from ArchiveBox server">
                🗑
              </button>
              <button className="archivebox-overlay__action" onClick={viewRemoteSnapshot} disabled={remoteStatus !== 'archived'} title="View archived copy on server">
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

function showOverlay() {
  if (host) {
    host.remove();
    host = null;
  }
  host = document.createElement('div');
  host.id = 'archivebox-extension-root';
  (document.body || document.documentElement).appendChild(host);
  root = ReactDOM.createRoot(host);
  root.render(<ArchiveBoxOverlay />);
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

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      switch (message.type) {
        case 'hide_archivebox_overlay':
          close();
          return Promise.resolve({ ok: true });

        case 'show_archivebox_overlay':
          showOverlay();
          break;

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
