import { activeServer, requireServer } from '@/src/lib/server_registry';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  ScanLine,
  FileCode2,
  HardDrive,
  Server,
  Zap,
  CheckCircle2,
  Cookie,
  Plus,
  RefreshCw,
  ShieldCheck,
  Clock3,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FileInput,
  Pencil,
  Search,
  Settings2,
  Trash2,
  Upload,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { SnapshotSyncStatus } from '@/src/components/SnapshotSyncStatus';
import { refreshSnapshotArtifactReceipts } from '@/src/lib/archiveboxArtifacts';
import { getServerPersonas, submitSnapshot, addToArchiveBox, archiveBoxServerUrlMatches, removeFromArchiveBox, requestServerHostPermission, syncArchiveBoxSnapshotTags, testApiKey, testServerUrl } from '@/src/lib/archivebox';
import { defaultTabManagerPlusExtensionId, mhtmlUnsupportedMessage, supportsMhtmlCapture, supportsDirectBrowserImport } from '@/src/lib/browserCapabilities';
import { loadBookmarkSnapshots, loadHistorySnapshots, loadSafariExportSnapshots, type SafariImportSource } from '@/src/lib/browserData';
import { formatCookiesForExport, getCookiesByDomain } from '@/src/lib/cookies';
import { CookieSitePicker } from './CookieSitePicker';
import { cookieSiteDomain, groupCookieSites } from '@/src/lib/cookieSites';
import {
  archiveboxExportBaseName,
  downloadCsv,
  downloadJson,
  snapshotCsvContent,
  snapshotJsonContent,
} from '@/src/lib/downloads';
import {
  assertLocalCaptureStorageAvailable,
  readSnapshotSingleFileBlob,
  readSnapshotMhtmlBlob,
  readSnapshotScreenshotBlob,
  readSnapshotScreenshotBlobs,
  readSnapshotOpfsFiles,
} from '@/src/lib/screenshotStorage';
import { renderMhtmlToHtml } from '@/src/lib/mhtml';
import { createSnapshot, filterSnapshots, uniqueTags } from '@/src/lib/snapshots';
import { matchingTagSuggestions } from '@/src/lib/tags';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { getCookieSyncStates, disablePersonaCookieSync, syncPersonaManually, type CookieSyncState } from '@/src/lib/cookieSync';
import { currentPersonaSettings, detectPersonaLocation } from '@/src/lib/personaSettings';
import { compactUuid, uuidv7 } from '@/src/lib/uuid';
import {
  defaultConfig,
  defaultPersona,
  ensurePersonas,
  getConfig,
  getPersonas,
  getSnapshots,
  setActivePersona,
  updateServer,
  removeServer,
  mutatePersonas,
  updatePersona,
  mutateSnapshots,
} from '@/src/lib/storage';
import type { ConfigPatch, ConfigState, Persona, RuntimeMessage, RuntimeResponse, Snapshot, StoredCookie } from '@/src/lib/types';
import { retentionDurations } from '@/src/lib/types';

type Tab = 'urls' | 'config' | 'profiles' | 'import';
type Status = { kind: 'idle' | 'success' | 'error' | 'warning'; text: string };

function snapshotSyncStatus(snapshot: Snapshot, serverId: string, pending?: Status & { serverId: string }): Status {
  // Popup/background submissions never populate this page's transient sync map.
  // Acceptance is durable even while uploads run; use the selected server's receipt.
  const receipt = snapshot.remote_copies?.[serverId];
  if (receipt?.delivery_error) return { kind: 'warning', text: t("URL submitted. Capture upload failed: $1", receipt.delivery_error) };
  if (receipt) return { kind: 'success', text: t("Submitted") };
  if (pending?.serverId === serverId) return pending;
  return { kind: 'idle', text: t("Not synced") };
}
type ImportItem = Snapshot & { selected: boolean; isNew: boolean };
type PersonaSettingKey = keyof Persona['settings'];
type EditablePersonaSettingKey = Exclude<PersonaSettingKey, 'geolocation'>;
type SavedUrlSortKey = 'date' | 'url' | 'tags' | 'sync';
type SortDirection = 'asc' | 'desc';
type OptionTab = { id: Tab; label: string; Icon: LucideIcon };
type LocalCaptureConfigKey = 'save_viewport_screenshots_locally' | 'save_screenshots_locally' | 'save_mhtml_locally' | 'save_singlefile_locally';
type TabManagerPlusTab = {
  favIconUrl?: string;
  title?: string;
  url?: string;
};
type TabManagerPlusSession = {
  date?: number | string;
  id?: string;
  name?: string;
  tabs?: TabManagerPlusTab[];
};
type TabManagerPlusResponse = {
  error?: string;
  message?: string;
  ok?: boolean;
  sessions?: TabManagerPlusSession[];
};
type MhtmlViewerState = {
  error?: string;
  html?: string;
  loading: boolean;
  partCount?: number;
  rawMhtml?: string;
  snapshot?: Snapshot;
  title?: string;
};
type ScreenshotViewerState = {
  blobs?: Blob[];
  error?: string;
  loading: boolean;
  objectUrls?: string[];
  snapshot?: Snapshot;
  title?: string;
};
type HtmlViewerState = {
  blob?: Blob;
  error?: string;
  html?: string;
  loading: boolean;
  snapshot?: Snapshot;
  title?: string;
};

const today = new Date();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const tabManagerPlusSavedSessionsMethod = 'tabManagerPlus.getSavedSessions';
function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function tagSafeText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function dateTag(prefix: string, value: number | string | undefined): string {
  const parsed = typeof value === 'number' || typeof value === 'string' ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${prefix}-${year}${month}${day}${hour}${minute}`;
}

function tabManagerPlusSessionTag(session: TabManagerPlusSession): string {
  const namedTag = tagSafeText(session.name || '');
  return namedTag || dateTag('tab-manager-plus', session.date);
}

function tabManagerPlusSessionsToImportItems(sessions: TabManagerPlusSession[], existingUrls: Set<string>): ImportItem[] {
  return sessions.flatMap((session) => {
    const sourceTag = 'tab-manager-plus';
    const sessionTag = tabManagerPlusSessionTag(session);
    const tags = [...new Set([sourceTag, sessionTag])];
    const timestamp = new Date(session.date || Date.now());
    const timestampIso = Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
    return (session.tabs || [])
      .filter((tab): tab is TabManagerPlusTab & { url: string } => Boolean(tab.url && isHttpUrl(tab.url)))
      .map((tab) => ({
        ...createSnapshot(tab.url, tags, tab.title || '', tab.favIconUrl || null),
        timestamp: timestampIso,
        selected: !existingUrls.has(tab.url),
        isNew: !existingUrls.has(tab.url),
      }));
  });
}

function snapshotDate(snapshot: Snapshot): string {
  return new Date(snapshot.timestamp).toLocaleString();
}

function compactSnapshotDate(snapshot: Snapshot): string {
  const date = new Date(snapshot.timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function serverUrlBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function safeFileSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function snapshotScreenshotDownloadName(snapshot: Snapshot, partIndex = 0): string {
  let host = 'unknown';
  try {
    host = new URL(snapshot.url).hostname;
  } catch {
    host = snapshot.title || snapshot.id;
  }
  const suffix = partIndex === 0 ? 'screenshot.png' : `screenshot-${partIndex}.png`;
  return `${snapshot.timestamp.slice(0, 10).replaceAll('-', '')}-${safeFileSegment(host)}-${safeFileSegment(snapshot.id)}-${suffix}`;
}

function snapshotMhtmlDownloadName(snapshot: Snapshot): string {
  let host = 'unknown';
  try {
    host = new URL(snapshot.url).hostname;
  } catch {
    host = snapshot.title || snapshot.id;
  }
  return `${snapshot.timestamp.slice(0, 10).replaceAll('-', '')}-${safeFileSegment(host)}-${safeFileSegment(snapshot.id)}-snapshot.mhtml`;
}

function snapshotSingleFileDownloadName(snapshot: Snapshot): string {
  let host = 'unknown';
  try {
    host = new URL(snapshot.url).hostname;
  } catch {
    host = snapshot.title || snapshot.id;
  }
  return snapshot.singlefile?.filename || `${snapshot.timestamp.slice(0, 10).replaceAll('-', '')}-${safeFileSegment(host)}-${safeFileSegment(snapshot.id)}-singlefile.html`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function extensionUrl(path: string): string {
  return (browser.runtime.getURL as (path: string) => string)(path);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function SnapshotFavicon({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="snapshot-favicon-placeholder" aria-hidden="true" />;
  return <img src={url} alt="" onError={() => setFailed(true)} />;
}

function SnapshotScreenshotThumb({ snapshot }: { snapshot: Snapshot }) {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl = '';
    setObjectUrl('');
    readSnapshotScreenshotBlob(snapshot.screenshot || snapshot.viewport_screenshot).then((blob) => {
      if (!blob || cancelled) return;
      nextObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(nextObjectUrl);
    });
    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [(snapshot.screenshot || snapshot.viewport_screenshot)?.path]);

  if (!objectUrl) {
    return <span className="snapshot-screenshot-placeholder" aria-hidden="true" />;
  }

  return (
    <a
      className="snapshot-screenshot-link"
      href={extensionUrl(`/options.html?screenshot=${encodeURIComponent(snapshot.id)}`)}
      target="_blank"
      rel="noopener noreferrer"
      title={t("Open local screenshot: $1", (snapshot.screenshot || snapshot.viewport_screenshot)?.path || '')}
    >
      <img
        className="snapshot-screenshot-thumb"
        src={objectUrl}
        alt=""
        loading="lazy"
      />
    </a>
  );
}

function SnapshotArchiveTitleLink({ snapshot }: { snapshot: Snapshot }) {
  const title = snapshot.title || t("Untitled page");

  const capture = snapshot.singlefile?.path
    ? { view: 'singlefile', label: t("SingleFile HTML"), path: snapshot.singlefile.path }
    : snapshot.mhtml?.path
      ? { view: 'mhtml', label: t("MHTML snapshot"), path: snapshot.mhtml.path }
      : null;

  if (!capture) {
    return <strong>{title}</strong>;
  }

  return (
    <a
      className="saved-url-mhtml-link"
      href={extensionUrl(`/options.html?${capture.view}=${encodeURIComponent(snapshot.id)}`)}
      target="_blank"
      rel="noopener noreferrer"
      title={t("Open local $1 snapshot: $2", capture.label, capture.path)}
    >
      <strong>{title}</strong>
    </a>
  );
}

function MhtmlViewer({ snapshot_id }: { snapshot_id: string }) {
  const [state, setState] = useState<MhtmlViewerState>({ loading: true });
  const [frameLoadCount, setFrameLoadCount] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMhtml() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshot_id);
        if (!snapshot) throw new Error(t("Saved URL not found"));
        const blob = await readSnapshotMhtmlBlob(snapshot.mhtml);
        if (!blob) throw new Error(t("Local MHTML snapshot not found"));

        const rawMhtml = await blob.text();
        let html = '';
        let title = snapshot.title || t("MHTML Snapshot");
        let partCount = 0;
        let error = '';

        try {
          const rendered = renderMhtmlToHtml(rawMhtml, snapshot.url);
          html = rendered.html;
          title = rendered.title || title;
          partCount = rendered.partCount;
        } catch (renderError) {
          error = t("Unable to render captured page preview: $1", (renderError as Error).message);
          html = [
            '<!doctype html>',
            '<html>',
            `<head><title>${escapeHtml(t("MHTML Snapshot"))}</title></head>`,
            '<body><pre style="white-space: pre-wrap; word-break: break-word;">',
            escapeHtml(rawMhtml),
            '</pre></body>',
            '</html>',
          ].join('');
        }

        if (!cancelled) {
          setState({
            error,
            html,
            loading: false,
            partCount,
            rawMhtml,
            snapshot,
            title,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            error: (error as Error).message,
            loading: false,
          });
        }
      }
    }

    loadMhtml();
    return () => {
      cancelled = true;
    };
  }, [snapshot_id]);

  function exportMhtml() {
    if (!state.rawMhtml || !state.snapshot) return;
    downloadBlob(
      new Blob([state.rawMhtml], { type: 'multipart/related' }),
      snapshotMhtmlDownloadName(state.snapshot),
    );
  }

  useEffect(() => {
    if (!state.rawMhtml || !state.snapshot) return undefined;

    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      exportMhtml();
    }

    const frameDocument = frameRef.current?.contentDocument;
    window.addEventListener('keydown', handleSaveShortcut, { capture: true });
    frameDocument?.addEventListener('keydown', handleSaveShortcut, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleSaveShortcut, { capture: true });
      frameDocument?.removeEventListener('keydown', handleSaveShortcut, { capture: true });
    };
  }, [frameLoadCount, state.rawMhtml, state.snapshot]);

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshot_id)}`);
  const title = state.title || state.snapshot?.title || t("MHTML Snapshot");

  return (
    <main className="app mhtml-viewer-page">
      <header className="mhtml-viewer-header">
        <div className="mhtml-viewer-header__text">
          <p>{t("Local MHTML Snapshot")}</p>
          <h1>{title}</h1>
          {state.snapshot ? (
            <a href={state.snapshot.url} target="_blank" rel="noreferrer">{state.snapshot.url}</a>
          ) : null}
        </div>
        <div className="mhtml-viewer-header__actions">
          {state.partCount ? <span className="status">{t("$1 parts", state.partCount)}</span> : null}
          <a className="button-link" href={backUrl}>{t("Saved URLs")}</a>
          <button className="icon-button" type="button" onClick={exportMhtml} disabled={!state.rawMhtml}>
            <Download size={15} />
            {t("Export MHTML")}
          </button>
        </div>
      </header>

      {state.loading ? <div className="mhtml-viewer-empty">{t("Loading local MHTML snapshot...")}</div> : null}
      {state.error ? (
        <div className={`status ${state.html ? 'warning' : 'error'}`}>
          <AlertTriangle size={14} />
          {state.error}
        </div>
      ) : null}
      {state.html ? (
        <iframe
          ref={frameRef}
          className="mhtml-viewer-frame"
          onLoad={() => setFrameLoadCount((count) => count + 1)}
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          srcDoc={state.html}
          title={title}
        />
      ) : null}
    </main>
  );
}

function SingleFileViewer({ snapshot_id }: { snapshot_id: string }) {
  const [state, setState] = useState<HtmlViewerState>({ loading: true });

  useEffect(() => {
    let cancelled = false;

    async function loadSingleFile() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshot_id);
        if (!snapshot) throw new Error(t("Saved URL not found"));
        const blob = await readSnapshotSingleFileBlob(snapshot.singlefile);
        if (!blob) throw new Error(t("Local SingleFile HTML snapshot not found"));

        const html = await blob.text();
        if (!cancelled) {
          setState({
            blob,
            html,
            loading: false,
            snapshot,
            title: snapshot.title || t("SingleFile HTML Snapshot"),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            error: (error as Error).message,
            loading: false,
          });
        }
      }
    }

    loadSingleFile();
    return () => {
      cancelled = true;
    };
  }, [snapshot_id]);

  function exportSingleFile() {
    if (!state.blob || !state.snapshot) return;
    downloadBlob(state.blob, snapshotSingleFileDownloadName(state.snapshot));
  }

  useEffect(() => {
    if (!state.blob || !state.snapshot) return undefined;

    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      exportSingleFile();
    }

    window.addEventListener('keydown', handleSaveShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSaveShortcut, { capture: true });
  }, [state.blob, state.snapshot]);

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshot_id)}`);
  const title = state.title || state.snapshot?.title || t("SingleFile HTML Snapshot");
  const singlefile = state.snapshot?.singlefile;

  return (
    <main className="app mhtml-viewer-page">
      <header className="mhtml-viewer-header">
        <div className="mhtml-viewer-header__text">
          <p>{t("Local SingleFile HTML Snapshot")}</p>
          <h1>{title}</h1>
          {state.snapshot ? (
            <a href={state.snapshot.url} target="_blank" rel="noreferrer">{state.snapshot.url}</a>
          ) : null}
        </div>
        <div className="mhtml-viewer-header__actions">
          {singlefile ? <span className="status">{Math.ceil(singlefile.size / 1024)} KB</span> : null}
          <a className="button-link" href={backUrl}>{t("Saved URLs")}</a>
          <button className="icon-button" type="button" onClick={exportSingleFile} disabled={!state.blob}>
            <Download size={15} />
            {t("Export HTML")}
          </button>
        </div>
      </header>

      {state.loading ? <div className="mhtml-viewer-empty">{t("Loading local SingleFile HTML snapshot...")}</div> : null}
      {state.error ? (
        <div className="status error">
          <AlertTriangle size={14} />
          {state.error}
        </div>
      ) : null}
      {state.html ? (
        <iframe
          className="mhtml-viewer-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          srcDoc={state.html}
          title={title}
        />
      ) : null}
    </main>
  );
}

function ScreenshotViewer({ snapshot_id }: { snapshot_id: string }) {
  const [state, setState] = useState<ScreenshotViewerState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    let objectUrls: string[] = [];

    async function loadScreenshot() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshot_id);
        if (!snapshot) throw new Error(t("Saved URL not found"));
        const blobs = await readSnapshotScreenshotBlobs(snapshot.screenshot || snapshot.viewport_screenshot);
        if (blobs.length === 0) throw new Error(t("Local screenshot not found"));

        const nextObjectUrls = blobs.map((blob) => URL.createObjectURL(blob));
        if (cancelled) {
          nextObjectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        objectUrls = nextObjectUrls;
        setState({
          blobs,
          loading: false,
          objectUrls,
          snapshot,
          title: snapshot.title || t("Screenshot"),
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            error: (error as Error).message,
            loading: false,
          });
        }
      }
    }

    loadScreenshot();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [snapshot_id]);

  function exportScreenshot() {
    if (!state.blobs?.length || !state.snapshot) return;
    state.blobs.forEach((blob, index) => downloadBlob(blob, snapshotScreenshotDownloadName(state.snapshot as Snapshot, index)));
  }

  useEffect(() => {
    if (!state.blobs?.length || !state.snapshot) return undefined;

    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      exportScreenshot();
    }

    window.addEventListener('keydown', handleSaveShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSaveShortcut, { capture: true });
  }, [state.blobs, state.snapshot]);

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshot_id)}`);
  const title = state.title || state.snapshot?.title || t("Screenshot");
  const screenshot = state.snapshot?.screenshot || state.snapshot?.viewport_screenshot;
  const screenshotObjectUrls = state.objectUrls || [];
  const visibleScreenshotUrl = screenshotObjectUrls[0];
  const fullPageScreenshotUrls = screenshotObjectUrls.length > 1 ? screenshotObjectUrls.slice(1) : screenshotObjectUrls;
  const screenshotHtml = state.objectUrls?.length ? [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'html,body{margin:0;min-height:100%;background:#1c1814;overflow-x:hidden;}',
    'body{padding:0;}',
    'img{display:block;width:100%;max-width:none;height:auto;background:#fff;}',
    '.screenshot-separator{display:flex;align-items:center;gap:12px;margin:0;padding:14px 18px;background:#1c1814;color:#f7efe4;font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase;}',
    '.screenshot-separator::before,.screenshot-separator::after{content:"";height:1px;flex:1;background:#7a6653;}',
    '</style>',
    '</head>',
    '<body>',
    ...fullPageScreenshotUrls.map((objectUrl, index) => (
      `<img src="${objectUrl}" alt="${escapeHtml(title)}${screenshotObjectUrls.length > 1 ? ` ${index + 1}` : ''}">`
    )),
    ...(visibleScreenshotUrl && screenshotObjectUrls.length > 1 ? [
      `<div class="screenshot-separator">${escapeHtml(t("Initial visible-area screenshot"))}</div>`,
      `<img src="${visibleScreenshotUrl}" alt="${escapeHtml(t("Initial visible-area screenshot"))}">`,
    ] : []),
    '</body>',
    '</html>',
  ].join('') : '';

  return (
    <main className="app mhtml-viewer-page">
      <header className="mhtml-viewer-header">
        <div className="mhtml-viewer-header__text">
          <p>{t("Local Screenshot")}</p>
          <h1>{title}</h1>
          {state.snapshot ? (
            <a href={state.snapshot.url} target="_blank" rel="noreferrer">{state.snapshot.url}</a>
          ) : null}
        </div>
        <div className="mhtml-viewer-header__actions">
          {screenshot ? <span className="status">{screenshot.width}x{screenshot.height}{screenshot.parts && screenshot.parts.length > 1 ? ` · ${t("$1 parts", screenshot.parts.length)}` : ''}</span> : null}
          <a className="button-link" href={backUrl}>{t("Saved URLs")}</a>
          <button className="icon-button" type="button" onClick={exportScreenshot} disabled={!state.blobs?.length}>
            <Download size={15} />
            {t("Export PNG")}
          </button>
        </div>
      </header>

      {state.loading ? <div className="mhtml-viewer-empty">{t("Loading local screenshot...")}</div> : null}
      {state.error ? (
        <div className="status error">
          <AlertTriangle size={14} />
          {state.error}
        </div>
      ) : null}
      {screenshotHtml ? (
        <iframe
          className="mhtml-viewer-frame screenshot-viewer-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          srcDoc={screenshotHtml}
          title={title}
        />
      ) : null}
    </main>
  );
}

export default function OptionsApp() {
  const [, setLanguageLoaded] = useState(false);

  useEffect(() => {
    getConfig().then((storedConfig) => {
      setUiLanguage(storedConfig.ui_language);
      setLanguageLoaded(true);
    }).catch(() => setLanguageLoaded(true));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('screenshot') || params.get('mhtml') || params.get('singlefile');
    if (!id) return;
    function onEntriesChanged(changes: Record<string, { newValue?: unknown }>, area: string) {
      if (area !== 'local' || !changes.entries) return;
      const entries = changes.entries.newValue;
      if (Array.isArray(entries) && !entries.some((entry: Snapshot) => entry.id === id)) {
        // Unload rendered captures and blob URLs when their local record expires.
        window.location.replace(extensionUrl('/options.html'));
      }
    }
    browser.storage.onChanged.addListener(onEntriesChanged);
    return () => browser.storage.onChanged.removeListener(onEntriesChanged);
  }, []);

  const params = new URLSearchParams(window.location.search);
  const screenshotSnapshotId = params.get('screenshot');
  if (screenshotSnapshotId) {
    return <ScreenshotViewer snapshot_id={screenshotSnapshotId} />;
  }
  const mhtmlSnapshotId = params.get('mhtml');
  if (mhtmlSnapshotId) {
    return <MhtmlViewer snapshot_id={mhtmlSnapshotId} />;
  }
  const singleFileSnapshotId = params.get('singlefile');
  if (singleFileSnapshotId) {
    return <SingleFileViewer snapshot_id={singleFileSnapshotId} />;
  }
  return <OptionsMain />;
}

function OptionsMain() {
  const [tab, setTab] = useState<Tab>('urls');
  const [snapshots, setSnapshotsState] = useState<Snapshot[]>([]);
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [highlightedSnapshotId, setHighlightedSnapshotId] = useState('');
  const [config, setConfigState] = useState<ConfigState>(defaultConfig);
  const [serverStatus, setServerStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [apiStatus, setApiStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [testStatus, setTestStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [localCaptureStatus, setLocalCaptureStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [permissionsStatus, setPermissionsStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [savedUrlStatus, setSavedUrlStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [importStatus, setImportStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [cookieStatus, setCookieStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [cookieSyncStates, setCookieSyncStates] = useState<Record<string, CookieSyncState>>({});
  const [personaStatus, setPersonaStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [syncStatuses, setSyncStatuses] = useState<Record<string, Status & { serverId: string }>>({});
  const checkedArtifactReceipts = useRef(new Set<string>());
  const [personas, setPersonasState] = useState<Persona[]>([]);
  const [active_persona, setActivePersonaState] = useState('');
  const [cookiesByDomain, setCookiesByDomain] = useState<Record<string, StoredCookie[]>>({});
  const [selectedCookieDomains, setSelectedCookieDomains] = useState<Set<string>>(new Set());
  const [viewedPersonaId, setViewedPersonaId] = useState('');
  const [cookiesLoaded, setCookiesLoaded] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [tabIcons, setTabIcons] = useState<Record<string, string>>({});
  const [syncingPersonas, setSyncingPersonas] = useState<Set<string>>(new Set());
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [safariImportSource, setSafariImportSource] = useState<SafariImportSource>('all');
  const [importLoading, setImportLoading] = useState(false);
  const [importFilter, setImportFilter] = useState('');
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [importStartDate, setImportStartDate] = useState(dateInputValue(yesterday));
  const [importEndDate, setImportEndDate] = useState(dateInputValue(today));
  const [importTags, setImportTags] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [inlineTagEditor, setInlineTagEditor] = useState<{ snapshot_id: string; value: string } | null>(null);
  const [testUrl, setTestUrl] = useState('https://example.com');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [savedUrlSortKey, setSavedUrlSortKey] = useState<SavedUrlSortKey>('date');
  const [savedUrlSortDirection, setSavedUrlSortDirection] = useState<SortDirection>('desc');
  const tagDialogRef = useRef<HTMLDialogElement>(null);
  const browserLanguage = (() => {
    try {
      return browser.i18n?.getUILanguage?.() || navigator.language || t("Unknown");
    } catch {
      return navigator.language || t("Unknown");
    }
  })();
  const optionTabs: OptionTab[] = [
    { id: 'urls', label: t("Saved URLs"), Icon: Database },
    { id: 'config', label: t("Configuration"), Icon: Settings2 },
    { id: 'profiles', label: t("Cookies"), Icon: UserRoundCog },
    { id: 'import', label: t("Bulk Import URLs"), Icon: FileInput },
  ];

  async function refreshAll() {
    const [storedSnapshots, storedConfig, personaState] = await Promise.all([
      getSnapshots(),
      getConfig(),
      ensurePersonas(),
    ]);
    setUiLanguage(storedConfig.ui_language);
    setSnapshotsState(storedSnapshots);
    setConfigState(storedConfig);
    if (personaState.personas.some((persona) => persona.name === 'Private')) {
      const { privateSettingsInitialized } = await browser.storage.local.get('privateSettingsInitialized');
      if (!privateSettingsInitialized) {
        const defaults = currentPersonaSettings();
        personaState.personas = await mutatePersonas((items) => items.map((persona) => persona.name === 'Private'
          ? { ...persona, settings: { ...defaults, ...persona.settings } } : persona));
        await browser.storage.local.set({ privateSettingsInitialized: true });
      }
    }
    setCookieSyncStates(await getCookieSyncStates());
    setPersonasState(personaState.personas);
    setActivePersonaState(personaState.active_persona);
  }

  useEffect(() => {
    refreshAll();
    const params = new URLSearchParams(window.location.search);
    const search = params.get('search');
    if (search) setFilterText(search);
    setHighlightedSnapshotId(params.get('highlight') || '');

    function restoreFilterFromUrl() {
      const nextParams = new URLSearchParams(window.location.search);
      setFilterText(nextParams.get('search') || '');
      setHighlightedSnapshotId(nextParams.get('highlight') || '');
    }
    function refreshPersonas(changes: Record<string, { newValue?: unknown }>, area: string) {
      if (area !== 'local') return;
      if (changes.entries) getSnapshots().then((entries) => {
        setSnapshotsState(entries);
        const ids = new Set(entries.map((entry) => entry.id));
        setSelectedSnapshots((current) => new Set([...current].filter((id) => ids.has(id))));
        setSyncStatuses((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
        setInlineTagEditor((current) => current && ids.has(current.snapshot_id) ? current : null);
        if (!entries.length) { setModalTags([]); setEditingTags(false); }
      });
      if (Object.keys(changes).some((key) => key.startsWith('cookie_sync:'))) getCookieSyncStates().then(setCookieSyncStates);
      if (changes.personas) getPersonas().then((state) => setPersonasState(state.personas));
      if (changes.server_registry || changes.server_policies || changes.local_retention_ms || changes.capture_retention_ms || Object.keys(changes).some(key => key.startsWith('save_'))) getConfig().then(setConfigState);
      if (changes.active_persona) setActivePersonaState(String(changes.active_persona.newValue || ''));
    }
    browser.storage.onChanged.addListener(refreshPersonas);
    window.addEventListener('popstate', restoreFilterFromUrl);
    return () => {
      browser.storage.onChanged.removeListener(refreshPersonas);
      window.removeEventListener('popstate', restoreFilterFromUrl);
    };
  }, []);

  useEffect(() => {
    if (!editingTags) return;
    const dialog = tagDialogRef.current;
    if (!dialog) return;

    function handleClose() {
      setEditingTags(false);
    }

    dialog.addEventListener('close', handleClose);
    if (!dialog.open) {
      dialog.showModal();
    }

    return () => dialog.removeEventListener('close', handleClose);
  }, [editingTags]);

  const visibleSnapshots = useMemo(() => {
    const direction = savedUrlSortDirection === 'asc' ? 1 : -1;
    return [...filterSnapshots(snapshots, filterText)].sort((a, b) => {
      let comparison = 0;
      if (savedUrlSortKey === 'date') {
        comparison = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      } else if (savedUrlSortKey === 'url') {
        comparison = (a.title || a.url).toLowerCase().localeCompare((b.title || b.url).toLowerCase());
      } else if (savedUrlSortKey === 'tags') {
        comparison = a.tags.join(' ').toLowerCase().localeCompare(b.tags.join(' ').toLowerCase());
      } else {
        const aStatus = snapshotSyncStatus(a, activeServer(config)?.id || '', syncStatuses[a.id]).text;
        const bStatus = snapshotSyncStatus(b, activeServer(config)?.id || '', syncStatuses[b.id]).text;
        comparison = aStatus.toLowerCase().localeCompare(bStatus.toLowerCase());
      }
      return comparison * direction;
    });
  }, [config, filterText, savedUrlSortDirection, savedUrlSortKey, snapshots, syncStatuses]);
  const visibleSnapshotIds = useMemo(() => visibleSnapshots.map((snapshot) => snapshot.id), [visibleSnapshots]);
  const visibleSelectedCount = useMemo(
    () => visibleSnapshotIds.filter((id) => selectedSnapshots.has(id)).length,
    [selectedSnapshots, visibleSnapshotIds],
  );
  const allVisibleSelected = visibleSnapshotIds.length > 0 && visibleSelectedCount === visibleSnapshotIds.length;

  useEffect(() => {
    if (!highlightedSnapshotId) return;
    const row = document.querySelector<HTMLElement>('[data-highlighted-snapshot="true"]');
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightedSnapshotId, visibleSnapshots]);

  const tags = useMemo(() => uniqueTags(snapshots), [snapshots]);
  const hasSavedScreenshots = useMemo(() => snapshots.some((snapshot) => Boolean((snapshot.screenshot || snapshot.viewport_screenshot)?.path)), [snapshots]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    visibleSnapshots.forEach((snapshot) => {
      snapshot.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return [...counts.entries()].sort(([tagA, countA], [tagB, countB]) => (
      countB === countA ? tagA.localeCompare(tagB) : countB - countA
    ));
  }, [visibleSnapshots]);

  const modalTagSuggestions = useMemo(() => {
    return matchingTagSuggestions(tags, newTag, modalTags);
  }, [modalTags, newTag, tags]);

  const filteredImportItems = useMemo(() => {
    const lowered = importFilter.toLowerCase();
    return importItems.filter((item) => {
      const matchesFilter = `${item.url} ${item.title}`.toLowerCase().includes(lowered);
      return matchesFilter && (!showNewOnly || item.isNew);
    });
  }, [importItems, importFilter, showNewOnly]);

  const visibleSelectedImportCount = useMemo(
    () => filteredImportItems.filter((item) => item.selected).length,
    [filteredImportItems],
  );

  const viewedPersona = personas.find(item => item.id === viewedPersonaId)
    || personas.find(item => item.id === active_persona) || personas[0];
  const savedCookieSites = useMemo(() => groupCookieSites(viewedPersona?.cookies || {}), [viewedPersona?.cookies]);
  const cachedCookieIcons = useMemo(() => {
    const icons: Record<string, string> = {};
    for (const snapshot of snapshots) {
      if (!snapshot.favIconUrl) continue;
      try { icons[cookieSiteDomain(new URL(snapshot.url).hostname)] = snapshot.favIconUrl; } catch { /* Invalid saved URL. */ }
    }
    return { ...icons, ...tabIcons };
  }, [snapshots, tabIcons]);

  useEffect(() => {
    if (tab !== 'profiles' || cookiesLoaded) return;
    void browser.permissions.contains({ permissions: ['cookies', 'tabs'], origins: ['*://*/*'] })
      .then(granted => { if (granted) void loadCookies(false); });
  }, [tab]);

  useEffect(() => { setSelectedCookieDomains(new Set()); }, [viewedPersona?.id]);

  const server = activeServer(config);
  const [serverDraft, setServerDraft] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [savingServer, setSavingServer] = useState(false);
  const server_id = server?.id || '';
  useEffect(() => {
    if (!server) return;
    const candidates = snapshots.filter(snapshot => {
      const copy = snapshot.remote_copies?.[server.id];
      const key = `${server.id}:${snapshot.id}:${copy?.snapshot_id}:${copy?.crawl_id}`;
      if (!copy?.snapshot_id || copy.artifacts !== undefined || checkedArtifactReceipts.current.has(key)) return false;
      checkedArtifactReceipts.current.add(key);
      return true;
    });
    // Recover historical receipts sequentially; the list stays usable offline.
    void (async () => {
      for (const snapshot of candidates) await refreshSnapshotArtifactReceipts(server, snapshot).catch(() => undefined);
    })();
  }, [snapshots, server_id]);
  const [server_personas, setServerPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [persona_error, setPersonaError] = useState('');
  useEffect(() => {
    let current = true;
    setServerPersonas([]);
    setPersonaError('');
    if (server?.token) getServerPersonas(server).then(
      (items) => { if (current) setServerPersonas(items); },
      (error) => { if (current) setPersonaError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { current = false; };
  }, [server?.id, server?.server, server?.token]);
  function destination() { return requireServer(config, server_id); }
  async function saveServer(patch: Parameters<typeof updateServer>[1]) {
    const id = server?.id ?? null;
    setSavingServer(true);
    if (id && patch.policy) setConfigState((current) => ({
      ...current,
      server_policies: { ...current.server_policies, [id]: { ...destination().policy, ...patch.policy } },
    }));
    try {
      if (patch.server?.trim() === '' && id) await removeServer(id);
      else await updateServer(id, patch);
      setConfigState(await getConfig());
    } catch (error) {
      setConfigState(await getConfig());
      setServerStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSavingServer(false);
    }
  }
  const archiveboxServerUrlIsValid = isHttpUrl((server?.server || ''));
  const archiveboxServerBaseUrl = serverUrlBase((server?.server || ''));

  function updateSavedUrlFilter(value: string) {
    setFilterText(value);
    const nextUrl = value
      ? `${window.location.pathname}?search=${encodeURIComponent(value)}`
      : window.location.pathname;
    setHighlightedSnapshotId('');
    window.history.pushState({}, '', nextUrl);
  }

  function updateSavedUrlSort(key: SavedUrlSortKey) {
    if (savedUrlSortKey === key) {
      setSavedUrlSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSavedUrlSortKey(key);
    setSavedUrlSortDirection(key === 'date' ? 'desc' : 'asc');
  }

  function savedUrlSortIndicator(key: SavedUrlSortKey) {
    if (savedUrlSortKey !== key) return '↕';
    return savedUrlSortDirection === 'asc' ? '↑' : '↓';
  }

  const selectedSnapshotList = useMemo(
    () => snapshots.filter((snapshot) => selectedSnapshots.has(snapshot.id)),
    [selectedSnapshots, snapshots],
  );

  function exportSelectedSnapshots(format: 'csv' | 'json') {
    if (!selectedSnapshotList.length) return;
    setExportMenuOpen(false);
    if (format === 'csv') downloadCsv(selectedSnapshotList);
    else downloadJson(selectedSnapshotList);
  }

  async function exportSelectedLocalArtifacts(
    artifact: 'screenshot' | 'mhtml' | 'singlefile',
    readBlob: (snapshot: Snapshot) => Promise<Blob | null>,
    downloadName: (snapshot: Snapshot) => string,
  ) {
    if (!selectedSnapshotList.length) return;
    setExportMenuOpen(false);

    let downloaded = 0;
    let missing = 0;
    for (const snapshot of selectedSnapshotList) {
      const blob = await readBlob(snapshot);
      if (!blob) {
        missing += 1;
        continue;
      }
      downloadBlob(blob, downloadName(snapshot));
      downloaded += 1;
    }

    if (downloaded === 0) {
      const artifactLabel = artifact === 'screenshot' ? t("screenshots") : artifact === 'mhtml' ? t("MHTML snapshots") : t("SingleFile HTML snapshots");
      setSavedUrlStatus({ kind: 'warning', text: t("No selected snapshots have $1", artifactLabel) });
      return;
    }

    const artifactLabel = artifact === 'screenshot' ? t("screenshots") : artifact === 'mhtml' ? t("MHTML snapshots") : t("SingleFile HTML snapshots");
    setSavedUrlStatus({
      kind: missing > 0 ? 'warning' : 'success',
      text: missing > 0
        ? t("Downloaded $1 $2; $3 missing", downloaded, artifactLabel, missing)
        : t("Downloaded $1 $2", downloaded, artifactLabel),
    });
  }

  async function exportSelectedScreenshots() {
    if (!selectedSnapshotList.length) return;
    setExportMenuOpen(false);

    let downloaded = 0;
    let missing = 0;
    for (const snapshot of selectedSnapshotList) {
      const blobs = await readSnapshotScreenshotBlobs(snapshot.screenshot || snapshot.viewport_screenshot);
      if (blobs.length === 0) {
        missing += 1;
        continue;
      }
      blobs.forEach((blob, index) => downloadBlob(blob, snapshotScreenshotDownloadName(snapshot, index)));
      downloaded += blobs.length;
    }

    if (downloaded === 0) {
      setSavedUrlStatus({ kind: 'warning', text: t("No selected snapshots have $1", t("screenshots")) });
      return;
    }

    setSavedUrlStatus({
      kind: missing > 0 ? 'warning' : 'success',
      text: missing > 0
        ? t("Downloaded $1 $2; $3 missing", downloaded, t("screenshots"), missing)
        : t("Downloaded $1 $2", downloaded, t("screenshots")),
    });
  }

  async function exportSelectedMhtml() {
    await exportSelectedLocalArtifacts(
      'mhtml',
      (snapshot) => readSnapshotMhtmlBlob(snapshot.mhtml),
      snapshotMhtmlDownloadName,
    );
  }

  async function exportSelectedSingleFile() {
    await exportSelectedLocalArtifacts(
      'singlefile',
      (snapshot) => readSnapshotSingleFileBlob(snapshot.singlefile),
      snapshotSingleFileDownloadName,
    );
  }

  async function exportSelectedZip() {
    if (!selectedSnapshotList.length) return;
    setExportMenuOpen(false);
    setSavedUrlStatus({ kind: 'idle', text: t("Building ZIP export for $1 snapshots...", selectedSnapshotList.length) });

    const baseName = archiveboxExportBaseName();
    const files: Record<string, Uint8Array> = {
      [`${baseName}.csv`]: strToU8(snapshotCsvContent(selectedSnapshotList)),
      [`${baseName}.json`]: strToU8(snapshotJsonContent(selectedSnapshotList)),
    };
    let includedArtifacts = 0;

    for (const snapshot of selectedSnapshotList) {
      const snapshotFiles = await readSnapshotOpfsFiles(snapshot);
      for (const file of snapshotFiles) {
        files[file.path] = await blobToUint8Array(file.blob);
        includedArtifacts += 1;
      }
    }

    const zipBytes = zipSync(files, { level: 6 });
    downloadBlob(
      new Blob([uint8ArrayToArrayBuffer(zipBytes)], { type: 'application/zip' }),
      `${baseName}.zip`,
    );
    setSavedUrlStatus({
      kind: 'success',
      text: t("Exported ZIP with $1 local artifacts", includedArtifacts),
    });
  }

  async function persistSnapshots(update: (entries: Snapshot[]) => Snapshot[]) {
    const next = await mutateSnapshots(update);
    setSnapshotsState(next);
    return next;
  }

  function toggleSnapshot(id: string) {
    setSelectedSnapshots((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateSnapshotTags(snapshot_id: string, tags: string[], message: string) {
    const existingSnapshot = snapshots.find((snapshot) => snapshot.id === snapshot_id);
    if (existingSnapshot?.remote_copies?.[server_id]?.snapshot_id) {
      try {
        await syncArchiveBoxSnapshotTags(destination(), existingSnapshot.remote_copies![server_id]!.snapshot_id!, existingSnapshot.tags, tags);
      } catch (error) {
        setSavedUrlStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    await persistSnapshots((snapshots) => snapshots.map((snapshot) => (
      snapshot.id === snapshot_id ? { ...snapshot, tags } : snapshot
    )));
    setSavedUrlStatus({ kind: 'success', text: message });
  }

  async function addInlineTag(snapshot: Snapshot, selectedTag?: string) {
    const tag = selectedTag || (inlineTagEditor?.snapshot_id === snapshot.id ? inlineTagEditor.value.trim() : '');
    if (!tag) {
      setInlineTagEditor(null);
      return;
    }
    const nextTags = [...new Set([...snapshot.tags, tag])];
    await updateSnapshotTags(snapshot.id, nextTags, t("Added tag \"$1\"", tag));
    setInlineTagEditor(null);
  }

  async function removeSnapshotTag(snapshot: Snapshot, tag: string) {
    await updateSnapshotTags(
      snapshot.id,
      snapshot.tags.filter((item) => item !== tag),
      t("Removed tag \"$1\"", tag),
    );
  }

  async function saveConfig(patch: ConfigPatch) {
    if (patch.ui_language) setUiLanguage(patch.ui_language);
    setConfigState(current => ({ ...current, ...patch, capture_retention_ms: Object.fromEntries(
      Object.entries({ ...current.capture_retention_ms, ...patch.capture_retention_ms }).filter(([, value]) => value !== null),
    ) }));
    // Dispatch before yielding: the background completes this write even if
    // the options page is immediately reloaded or closed.
    const response: RuntimeResponse = await browser.runtime.sendMessage({ type: 'set_config', patch } satisfies RuntimeMessage);
    if (!response.ok) throw new Error(response.errorMessage || 'Unable to save settings.');
  }

  async function testServer() {
    if (!archiveboxServerUrlIsValid) {
      setServerStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
      return;
    }
    setServerStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to this server URL so it can test the connection.") });
    try {
      await requestServerHostPermission(archiveboxServerBaseUrl);
    } catch (error) {
      setServerStatus({ kind: 'error', text: (error as Error).message });
      return;
    }
    setServerStatus({ kind: 'idle', text: t("Testing ArchiveBox server...") });
    try {
      await testServerUrl(archiveboxServerBaseUrl);
      setServerStatus({ kind: 'success', text: t("Server is reachable") });
    } catch (error) {
      setServerStatus({ kind: 'error', text: (error as Error).message || t("Server test failed") });
    }
  }

  async function testApiKeyValue() {
    if (!archiveboxServerUrlIsValid) {
      setApiStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
      return;
    }
    setApiStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to this server URL so it can test the API key.") });
    try {
      await requestServerHostPermission(archiveboxServerBaseUrl);
    } catch (error) {
      setApiStatus({ kind: 'error', text: (error as Error).message });
      return;
    }
    setApiStatus({ kind: 'idle', text: t("Testing ArchiveBox API key...") });
    try {
      const userId = await testApiKey(archiveboxServerBaseUrl, (server?.token || ''));
      setApiStatus({ kind: 'success', text: t("API key is valid: user_id = $1", userId || '') });
      setServerPersonas(await getServerPersonas(destination()));
      setPersonaError('');
    } catch (error) {
      setApiStatus({ kind: 'error', text: (error as Error).message || t("API key test failed") });
    }
  }

  async function testUrlPatterns() {
    const url = testUrl.trim();
    if (!url) {
      setTestStatus({ kind: 'error', text: t("Please enter a URL to test") });
      return;
    }
    if (archiveBoxServerUrlMatches((server?.server || ''), url)) {
      setTestStatus({ kind: 'warning', text: t("ArchiveBox server URLs are ignored.") });
      return;
    }

    let shouldArchive = false;
    try {
      shouldArchive = new RegExp(config.match_urls || /^$/).test(url);
    } catch (error) {
      setTestStatus({ kind: 'error', text: t("Error with match pattern: $1", (error as Error).message) });
      return;
    }

    try {
      if (new RegExp(config.exclude_urls || /^$/).test(url)) {
        setTestStatus({ kind: 'warning', text: t("URL is excluded from auto-archiving") });
        return;
      }
    } catch (error) {
      setTestStatus({ kind: 'error', text: t("Error with exclude pattern: $1", (error as Error).message) });
      return;
    }

    if (!shouldArchive) {
      setTestStatus({ kind: 'warning', text: t("URL does not match the auto-archive pattern") });
      return;
    }

    try {
      setTestStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to your configured server so it can submit the test URL.") });
      if (!archiveboxServerUrlIsValid) {
        setTestStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
        return;
      }
      await requestServerHostPermission(archiveboxServerBaseUrl);
      setTestStatus({ kind: 'idle', text: t("Submitting test URL...") });
      await addToArchiveBox(destination(), [url], ['test']);
      setTestStatus({ kind: 'success', text: t("URL was submitted to ArchiveBox") });
      setTestUrl('');
    } catch (error) {
      setTestStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  async function requestAllPermissions() {
    if (typeof browser.permissions?.request !== 'function') {
      setPermissionsStatus({ kind: 'warning', text: t("This browser does not support requesting optional permissions here.") });
      return;
    }
    const manifest = browser.runtime.getManifest();
    const optional = manifest.optional_permissions || [];
    const dataCollection = typeof (browser.runtime as { getBrowserInfo?: unknown }).getBrowserInfo === 'function'
      ? (manifest.browser_specific_settings?.gecko as { data_collection_permissions?: { optional?: string[] } } | undefined)?.data_collection_permissions?.optional || []
      : [];
    const isOrigin = (permission: string) => permission === '<all_urls>' || permission.includes('://');
    const request = {
      permissions: [...new Set(optional.filter((permission) => !isOrigin(permission)))] as Parameters<typeof browser.permissions.request>[0]['permissions'],
      origins: [...new Set([...(manifest.optional_host_permissions || []), ...optional.filter(isOrigin)])],
      ...(dataCollection.length ? { data_collection: [...new Set(dataCollection)] } : {}),
    };
    if (!request.permissions?.length && !request.origins.length && !dataCollection.length) {
      setPermissionsStatus({ kind: 'success', text: t("This extension build has no optional permissions to request.") });
      return;
    }
    setRequestingPermissions(true);
    setPermissionsStatus({ kind: 'idle', text: t("Waiting for permission approval...") });
    try {
      // Keep request() in the click handler before any await to preserve the user gesture.
      await browser.permissions.request(request);
      const granted = typeof browser.permissions.contains === 'function'
        ? await browser.permissions.contains(request) : false;
      const actual = dataCollection.length && typeof browser.permissions.getAll === 'function'
        ? await browser.permissions.getAll() as { data_collection?: string[] } : undefined;
      const dataGranted = dataCollection.every((permission) => actual?.data_collection?.includes(permission));
      setPermissionsStatus(granted && dataGranted
        ? { kind: 'success', text: t("All requested permissions are granted.") }
        : { kind: 'warning', text: t("Not all requested permissions were granted.") });
    } catch (error) {
      setPermissionsStatus({ kind: 'error', text: t("This browser could not grant the requested permissions: $1", error instanceof Error ? error.message : String(error)) });
    } finally {
      setRequestingPermissions(false);
    }
  }

  async function updateAutoArchive(enabled: boolean) {
    if (enabled) {
      setTestStatus({ kind: 'idle', text: t("Automatic archiving needs tabs and site access so it can detect matching pages as you browse.") });
      const granted = await browser.permissions.request({
        permissions: ['tabs'],
        origins: ['<all_urls>'],
      });
      if (!granted && !(await browser.permissions.contains({ permissions: ['tabs'], origins: ['<all_urls>'] }).catch(() => false))) return;
    }
    await saveConfig({ enable_auto_archive: enabled });
  }

  async function requestLocalCaptureStorage(): Promise<boolean> {
    const storageManager = navigator.storage as StorageManager & {
      persist?: () => Promise<boolean>;
    };
    const persistentStorage = await storageManager.persist?.().catch(() => false) || false;
    try {
      await assertLocalCaptureStorageAvailable();
    } catch (error) {
      setLocalCaptureStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      return false;
    }

    setLocalCaptureStatus({
      kind: 'success',
      text: persistentStorage
          ? t("Local capture saving enabled with persistent storage")
          : t("Local capture storage enabled"),
    });
    return true;
  }

  async function requestMhtmlCapturePermission(): Promise<boolean> {
    if (!supportsMhtmlCapture) {
      setLocalCaptureStatus({ kind: 'warning', text: mhtmlUnsupportedMessage() });
      return false;
    }

    setLocalCaptureStatus({ kind: 'idle', text: t("MHTML capture needs permission to save the current tab as a browser-generated MHTML file.") });
    const granted = await browser.permissions.request({ permissions: ['pageCapture'] }).catch(() => false);
    if (!granted && !(await browser.permissions.contains({ permissions: ['pageCapture'] }).catch(() => false))) {
      setLocalCaptureStatus({ kind: 'error', text: t("MHTML capture permission denied") });
      return false;
    }
    return true;
  }

  async function requestScreenshotCapturePermission(): Promise<boolean> {
    setLocalCaptureStatus({ kind: 'idle', text: t("Full-page screenshots need scripting permission only to scroll the current tab and restore it after capture.") });
    const granted = await browser.permissions.request({ permissions: ['scripting'] }).catch(() => false);
    if (!granted && !(await browser.permissions.contains({ permissions: ['scripting'] }).catch(() => false))) {
      setLocalCaptureStatus({ kind: 'error', text: t("Screenshot capture permission denied") });
      return false;
    }
    return true;
  }

  async function updateLocalCaptureSetting(key: LocalCaptureConfigKey, enabled: boolean) {
    if (enabled && key === 'save_screenshots_locally' && !(await requestScreenshotCapturePermission())) return;
    if (enabled && key === 'save_mhtml_locally' && !(await requestMhtmlCapturePermission())) return;

    await saveConfig({ [key]: enabled });
    if (enabled) {
      if (!(await requestLocalCaptureStorage())) {
        await saveConfig({ [key]: false });
      }
      return;
    }

    if (!enabled) {
      if (key === 'save_screenshots_locally') {
        await browser.permissions.remove({ permissions: ['scripting'] }).catch(() => false);
      }
      setLocalCaptureStatus({ kind: 'idle', text: '' });
    } else {
      setLocalCaptureStatus({ kind: 'success', text: t("Local capture storage enabled") });
    }
  }

  async function loadCookies(requestPermission = true) {
    setCookiesLoading(true);
    setCookieStatus({ kind: 'idle', text: '' });
    try {
      const granted = requestPermission && await browser.permissions.request({
        permissions: ['cookies', 'tabs'], origins: ['*://*/*'],
      });
      if (!granted && !(await browser.permissions.contains({ permissions: ['cookies', 'tabs'], origins: ['*://*/*'] }))) {
        setCookieStatus({ kind: 'error', text: t("Cookie permission denied") });
        return;
      }
      const nextCookies = await getCookiesByDomain();
      setCookiesByDomain(nextCookies);
      setSelectedCookieDomains(current => new Set([...current].filter(domain => domain in nextCookies)));
      setCookiesLoaded(true);
      const icons: Record<string, string> = {};
      for (const tab of await browser.tabs.query({})) {
        if (!tab.url || !tab.favIconUrl) continue;
        try { icons[cookieSiteDomain(new URL(tab.url).hostname)] = tab.favIconUrl; } catch { /* Non-web tab. */ }
      }
      setTabIcons(icons);
    } catch (error) {
      setCookieStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCookiesLoading(false);
    }
  }

  async function importSelectedCookies(targetPersonaId: string) {
    const targetPersona = personas.find((persona) => persona.id === targetPersonaId);
    if (!targetPersona) {
      setCookieStatus({ kind: 'warning', text: t("Select a profile to copy cookies into") });
      return;
    }
    if (selectedCookieDomains.size === 0) {
      setCookieStatus({ kind: 'warning', text: t("No cookie domains selected") });
      return;
    }
    const selectedCount = selectedCookieDomains.size;
    const nextPersonas = await mutatePersonas((items) => items.map((persona) => {
      if (persona.id !== targetPersonaId) return persona;
      const cookies = { ...persona.cookies };
      selectedCookieDomains.forEach((domain) => {
        const available = cookiesByDomain[domain] || cookies[domain];
        if (available) cookies[domain] = available;
      });
      return { ...persona, cookies, last_used: new Date().toISOString() };
    }));
    setPersonasState(nextPersonas);
    setSelectedCookieDomains(new Set());
    const persona = nextPersonas.find((item) => item.id === targetPersonaId);
    setCookieStatus({
      kind: 'success',
      text: t("Copied $1 domain cookies to $2", selectedCount, persona?.name || targetPersona.name),
    });
    const syncState = cookieSyncStates[`${server_id}:${targetPersonaId}`];
    if (persona && syncState && syncState.enabled !== false && syncState.server_origin === archiveboxServerBaseUrl) {
      await syncPersona(persona);
    }
  }

  async function createPersona() {
    const name = prompt(t("Enter name for new profile:"));
    if (!name) return;
    const persona = {
      ...defaultPersona(name),
      settings: await currentPersonaSettings(),
    };
    const nextPersonas = await mutatePersonas((items) => [...items, persona]);
    setPersonasState(nextPersonas);
    setViewedPersonaId(persona.id);
    await chooseActivePersona(persona);
    setPersonaStatus({ kind: 'success', text: t("Created profile \"$1\"", name) });
  }

  async function savePersona(persona: Persona, patch: Partial<Persona>) {
    await updatePersona(persona.id, (item) => ({ ...item, ...patch }));
    setPersonasState((await getPersonas()).personas);
  }

  async function deletePersona(id: string) {
    if (!confirm(t("Delete this profile? This cannot be undone."))) return;
    const nextPersonas = await mutatePersonas((items) => items.filter((persona) => persona.id !== id));
    setPersonasState(nextPersonas);
    if (active_persona === id) {
      const nextActive = nextPersonas[0]?.id || '';
      setActivePersonaState(nextActive);
      await setActivePersona(nextActive);
    }
    setPersonaStatus({ kind: 'success', text: t("Profile deleted") });
  }

  async function chooseActivePersona(persona: Persona) {
    setActivePersonaState(persona.id);
    await setActivePersona(persona.id);
    if (server) await saveServer({ persona: persona.name, policy: { local_persona_id: persona.id } });
  }

  async function detectPersonaSettings(persona: Persona) {
    // Start the location request directly in the click handler, before awaiting storage.
    const location = detectPersonaLocation().then((geolocation) => ({ geolocation, error: '' }),
      (error: GeolocationPositionError) => ({ geolocation: null, error: error.message }));
    await updatePersona(persona.id, (item) => ({ ...item, settings: { ...item.settings, ...currentPersonaSettings() } }));
    setPersonasState((await getPersonas()).personas);
    setPersonaStatus({ kind: 'idle', text: t('Browser settings updated; waiting for location permission or position.') });
    const result = await location;
    if (result.geolocation) {
      await updatePersona(persona.id, (item) => ({ ...item, settings: {
        ...item.settings, geolocation: result.geolocation,
        geography: `${result.geolocation!.latitude}, ${result.geolocation!.longitude}`,
      } }));
    }
    setPersonasState((await getPersonas()).personas);
    setPersonaStatus({ kind: result.error ? 'warning' : 'success', text: result.error
      ? t("Browser settings updated; location unavailable: $1", result.error)
      : t("Updated browser settings for $1", persona.name) });
  }

  async function syncPersona(persona: Persona) {
    setSyncingPersonas(current => new Set(current).add(persona.id));
    try {
      const latestPersonas = (await getPersonas()).personas;
      const personaToSync = latestPersonas.find((item) => item.id === persona.id) || persona;
      setPersonaStatus({ kind: 'idle', text: '' });
      await requestServerHostPermission(archiveboxServerBaseUrl);
      const response = await syncPersonaManually(destination(), personaToSync.id);
      const persona_id = response.persona?.id;
      const persona_url = persona_id
        ? `${archiveboxServerBaseUrl}/admin/personas/persona/${persona_id}/change/`
        : personaToSync.remote_personas?.[server_id]?.url;
      await savePersona(personaToSync, {
        last_used: new Date().toISOString(),
        remote_personas: { ...personaToSync.remote_personas, ...(persona_id && persona_url ? { [server_id]: { id: persona_id, url: persona_url } } : {}) },
      });
      setPersonaStatus({ kind: 'idle', text: '' });
    } catch (error) {
      setPersonaStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSyncingPersonas(current => { const next = new Set(current); next.delete(persona.id); return next; });
      setCookieSyncStates(await getCookieSyncStates());
    }
  }

  async function togglePersonaSync(persona: Persona, enabled: boolean) {
    if (enabled) return syncPersona(persona);
    const id = `${server_id}:${persona.id}`;
    setCookieSyncStates(current => ({ ...current, [id]: { ...current[id]!, enabled: false } }));
    try {
      await disablePersonaCookieSync(server_id, persona.id);
    } catch (error) {
      setPersonaStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCookieSyncStates(await getCookieSyncStates());
    }
  }

  async function updatePersonaSetting(persona: Persona, key: EditablePersonaSettingKey, value: string) {
    await updatePersona(persona.id, (item) => ({ ...item, settings: { ...item.settings, [key]: value } }));
    setPersonasState((await getPersonas()).personas);
  }

  async function removePersonaDomain(persona: Persona, domain: string) {
    await updatePersona(persona.id, (item) => {
      const cookies = { ...item.cookies };
      delete cookies[domain];
      return { ...item, cookies };
    });
    setSelectedCookieDomains(current => { const next = new Set(current); next.delete(domain); return next; });
    setPersonasState((await getPersonas()).personas);
  }

  async function loadSafariFiles(files: File[]) {
    if (!files.length) return;
    setImportLoading(true);
    setImportItems([]);
    setImportStatus({ kind: 'idle', text: t('Reading Safari export…') });
    try {
      const items = await loadSafariExportSnapshots(files, safariImportSource, importStartDate, importEndDate, new Set(snapshots.map(snapshot => snapshot.url)));
      setImportItems(items);
      setImportStatus({ kind: 'success', text: t('Loaded $1 Safari URLs', items.length) });
    } catch (error) {
      setImportStatus({ kind: 'error', text: (error as Error).message });
    } finally { setImportLoading(false); }
  }

  async function loadHistory() {
    if (!browser.runtime.getManifest().optional_permissions?.includes('history')) {
      setImportStatus({ kind: 'warning', text: t("History import is not supported in this browser.") });
      return;
    }
    setImportStatus({ kind: 'idle', text: t("History import needs history permission so browser history URLs can be added to the saved URL list.") });
    const granted = await browser.permissions.request({ permissions: ['history'] });
    if (!granted && !(await browser.permissions.contains({ permissions: ['history'] }).catch(() => false))) {
      setImportStatus({ kind: 'error', text: t("History permission denied") });
      return;
    }
    if (typeof browser.history?.search !== 'function') {
      setImportStatus({ kind: 'warning', text: t("History import is not supported in this browser.") });
      return;
    }
    const existingUrls = new Set(snapshots.map((snapshot) => snapshot.url));
    try {
      const items = await loadHistorySnapshots(importStartDate, importEndDate, existingUrls);
      setImportItems(items);
      setImportStatus({ kind: 'success', text: t("Loaded $1 history URLs", items.length) });
    } catch (error) {
      setImportStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  async function loadBookmarks() {
    if (!browser.runtime.getManifest().optional_permissions?.includes('bookmarks')) {
      setImportStatus({ kind: 'warning', text: t("Bookmark import is not supported in this browser.") });
      return;
    }
    setImportStatus({ kind: 'idle', text: t("Bookmark import needs bookmarks permission so bookmark URLs can be added to the saved URL list.") });
    const granted = await browser.permissions.request({ permissions: ['bookmarks'] });
    if (!granted && !(await browser.permissions.contains({ permissions: ['bookmarks'] }).catch(() => false))) {
      setImportStatus({ kind: 'error', text: t("Bookmark permission denied") });
      return;
    }
    if (typeof browser.bookmarks?.getTree !== 'function') {
      setImportStatus({ kind: 'warning', text: t("Bookmark import is not supported in this browser.") });
      return;
    }
    const existingUrls = new Set(snapshots.map((snapshot) => snapshot.url));
    const items = await loadBookmarkSnapshots(existingUrls);
    setImportItems(items);
    setImportStatus({ kind: 'success', text: t("Loaded $1 bookmark URLs", items.length) });
  }

  async function loadTabManagerPlus() {
    const extensionId = config.tab_manager_plus_extension_id || defaultTabManagerPlusExtensionId;
    setImportStatus({ kind: 'idle', text: t("Requesting saved sessions from Tab Manager Plus.") });
    try {
      const response = await browser.runtime.sendMessage(extensionId, {
        method: tabManagerPlusSavedSessionsMethod,
        displayName: 'ArchiveBox',
      }) as TabManagerPlusResponse;
      if (!response?.ok) {
        const message = response?.error === 'approval_required'
          ? t("Approve ArchiveBox in Tab Manager Plus options, then click Import from Tab Manager Plus again.")
          : response?.message || response?.error || t("Tab Manager Plus did not return saved sessions.");
        setImportStatus({ kind: response?.error === 'approval_required' ? 'warning' : 'error', text: message });
        return;
      }
      const existingUrls = new Set(snapshots.map((snapshot) => snapshot.url));
      const items = tabManagerPlusSessionsToImportItems(response.sessions || [], existingUrls);
      setImportItems(items);
      setImportStatus({ kind: 'success', text: t("Loaded $1 Tab Manager Plus URLs", items.length) });
    } catch (error) {
      setImportStatus({ kind: 'error', text: `${t("Failed to import from Tab Manager Plus")}: ${(error as Error).message}` });
    }
  }

  async function importSelectedUrls() {
    const tagsToAdd = importTags.split(',').map((tag) => tag.trim()).filter(Boolean);
    const selected = importItems.filter((item) => item.selected);
    if (!selected.length) {
      setImportStatus({ kind: 'warning', text: t("No items selected") });
      return;
    }
    const selectedIds = new Set(selected.map((item) => item.id));
    const imported = selected.map(({ selected: _selected, isNew: _isNew, ...snapshot }) => ({
      ...snapshot,
      id: uuidv7(),
      tags: [...new Set([...snapshot.tags, ...tagsToAdd])],
    }));
    await persistSnapshots((snapshots) => [...snapshots, ...imported]);
    setImportItems(importItems.map((item) => selectedIds.has(item.id)
      ? { ...item, selected: false, isNew: false }
      : item));
    setImportTags('');
    setFilterText('');
    window.history.pushState({}, '', window.location.pathname);
    setImportStatus({ kind: 'success', text: t("Successfully imported $1 URLs", imported.length) });
    setTab('urls');
  }

  function setAllVisibleImportItems(selected: boolean) {
    const visibleIds = new Set(filteredImportItems.filter((item) => item.isNew).map((item) => item.id));
    setImportItems((current) => current.map((item) => visibleIds.has(item.id) ? { ...item, selected } : item));
  }

  async function syncSelected() {
    const selected = snapshots.filter((snapshot) => selectedSnapshots.has(snapshot.id));
    if (!selected.length) {
      setSavedUrlStatus({ kind: 'warning', text: t("No snapshots selected") });
      return;
    }
    const archiveableSelected = selected.filter((snapshot) => !archiveBoxServerUrlMatches((server?.server || ''), snapshot.url));
    const ignoredSelected = selected.filter((snapshot) => archiveBoxServerUrlMatches((server?.server || ''), snapshot.url));
    if (ignoredSelected.length) {
      setSyncStatuses((current) => ({
        ...current,
        ...Object.fromEntries(ignoredSelected.map((snapshot) => [
          snapshot.id,
          { kind: 'warning' as const, text: t("ArchiveBox server URLs are ignored."), serverId: server_id },
        ])),
      }));
    }
    if (!archiveableSelected.length) {
      setSavedUrlStatus({ kind: 'warning', text: t("ArchiveBox server URLs are ignored.") });
      return;
    }
    setSavedUrlStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to your configured server so it can sync selected URLs.") });
    if (!archiveboxServerUrlIsValid) {
      setSavedUrlStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
      return;
    }
    try {
      await requestServerHostPermission(archiveboxServerBaseUrl);
    } catch (error) {
      setSavedUrlStatus({ kind: 'error', text: (error as Error).message });
      return;
    }
    setSavedUrlStatus({ kind: 'idle', text: t("Syncing $1 snapshots...", archiveableSelected.length) });
    let failed = 0;
    for (const snapshot of archiveableSelected) {
      setSyncStatuses((current) => ({
        ...current,
        [snapshot.id]: { kind: 'warning', text: t("Syncing..."), serverId: server_id },
      }));
      try {
        await submitSnapshot(destination(), snapshot);
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'success', text: t("Synced"), serverId: server_id },
        }));
      } catch (error) {
        failed += 1;
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'error', text: (error as Error).message, serverId: server_id },
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setSavedUrlStatus(failed
      ? { kind: 'error', text: `${t("Sync failed")}: ${failed}/${archiveableSelected.length}` }
      : { kind: 'success', text: t("Finished syncing $1 snapshots", archiveableSelected.length) });
  }

  function openTagEditor() {
    const selected = snapshots.filter((snapshot) => selectedSnapshots.has(snapshot.id));
    const commonTags = selected.reduce<Set<string> | null>((acc, snapshot) => {
      if (!acc) return new Set(snapshot.tags);
      return new Set([...acc].filter((tag) => snapshot.tags.includes(tag)));
    }, null);
    setModalTags(commonTags ? [...commonTags] : []);
    setNewTag('');
    setEditingTags(true);
  }

  function closeTagEditor() {
    if (tagDialogRef.current?.open) {
      tagDialogRef.current.close('cancel');
      return;
    }
    setEditingTags(false);
  }

  function addModalTag(tag: string) {
    const nextTag = tag.trim();
    if (!nextTag) return;
    setModalTags((current) => [...new Set([...current, nextTag])]);
    setNewTag('');
  }

  async function saveTagChanges() {
    for (const snapshot of snapshots.filter((item) => selectedSnapshots.has(item.id))) {
      if (!snapshot.remote_copies?.[server_id]?.snapshot_id) continue;
      try {
        await syncArchiveBoxSnapshotTags(destination(), snapshot.remote_copies![server_id]!.snapshot_id!, snapshot.tags, modalTags);
      } catch (error) {
        setSavedUrlStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    await persistSnapshots((snapshots) => snapshots.map((snapshot) => selectedSnapshots.has(snapshot.id)
      ? { ...snapshot, tags: modalTags }
      : snapshot));
    setEditingTags(false);
    setSavedUrlStatus({ kind: 'success', text: t("Updated tags on $1 snapshots", selectedSnapshots.size) });
  }

  async function deleteSelectedSnapshots() {
    const selectedIds = new Set(selectedSnapshots);
    if (!selectedIds.size) return;
    if (!confirm(t("Delete $1 snapshots?", selectedIds.size))) return;

    const snapshotsToDelete = snapshots.filter((snapshot) => selectedIds.has(snapshot.id));
    await persistSnapshots((snapshots) => snapshots.filter((snapshot) => !selectedIds.has(snapshot.id)));
    setSelectedSnapshots(new Set());

    const serverErrors: string[] = [];
    for (const snapshot of snapshotsToDelete) {
      if (!snapshot.remote_copies?.[server_id]?.snapshot_id) continue;
      try {
        await removeFromArchiveBox(destination(), snapshot);
      } catch (error) {
        serverErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (serverErrors.length) {
      setSavedUrlStatus({
        kind: 'warning',
        text: t("Deleted $1 local snapshots. Failed to delete $2 from server: $3", snapshotsToDelete.length, serverErrors.length, [...new Set(serverErrors)].join('; ')),
      });
      return;
    }
    setSavedUrlStatus({ kind: 'success', text: t("Deleted selected snapshots") });
  }

  async function writeClipboardText(text: string) {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error(t("Clipboard writing is not available in this browser."));
    }

    await navigator.clipboard.writeText(text);
  }

  async function copyPersonaCookies(persona: Persona) {
    try {
      const domainCount = Object.keys(persona.cookies).length;
      const cookieCount = Object.values(persona.cookies).reduce((sum, cookies) => sum + cookies.length, 0);
      await writeClipboardText(formatCookiesForExport(persona.cookies));
      setPersonaStatus({
        kind: 'success',
        text: t("$1 domain logins ($2 cookies) copied for $3", domainCount, cookieCount, persona.name),
      });
    } catch (error) {
      setPersonaStatus({
        kind: 'error',
        text: t("Failed to copy cookies: $1", error instanceof Error ? error.message : String(error)),
      });
    }
  }

  async function copyDomainCookies(domain: string, cookies: StoredCookie[]) {
    try {
      await writeClipboardText(formatCookiesForExport({ [domain]: cookies }));
      setCookieStatus({
        kind: 'success',
        text: t("$1 cookies copied for $2", cookies.length, domain),
      });
    } catch (error) {
      setCookieStatus({
        kind: 'error',
        text: t("Failed to copy cookies: $1", error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <img src={extensionUrl('icon/48.png')} alt="" />
          <div>
            <h1>{t("ArchiveBox Collector")}</h1>
            <p>{t("Collect browser URLs and submit captures to ArchiveBox.")}</p>
          </div>
        </div>
        <nav className="tabs" aria-label={t("Options sections")}>
          {optionTabs.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon aria-hidden="true" size={14} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      {tab === 'urls' && (
        <section className="layout">
          <div className="panel wide">
            <div className="toolbar saved-url-toolbar">
              <span className="saved-url-count">{t("$1 visible / $2 saved · $3 selected", visibleSnapshots.length, snapshots.length, visibleSelectedCount)}</span>
              <label className="search-field">
                <Search size={14} aria-hidden="true" />
                <input value={filterText} onChange={(event) => updateSavedUrlFilter(event.currentTarget.value)} placeholder={t("Search by URL, title, ID, timestamp, or tags")} />
              </label>
              <button className="icon-button" disabled={!selectedSnapshots.size} onClick={openTagEditor}>
                <Pencil size={14} aria-hidden="true" />
                <span>{t("Tags")}</span>
              </button>
              <div className="export-menu">
                <button
                  className="icon-button"
                  disabled={!selectedSnapshots.size}
                  onClick={() => setExportMenuOpen((open) => !open)}
                  aria-expanded={exportMenuOpen}
                  aria-haspopup="menu"
                >
                  <Download size={14} aria-hidden="true" />
                  <span>{t("Export")}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {exportMenuOpen && selectedSnapshots.size > 0 && (
                  <div className="export-menu__items" role="menu">
                    <button onClick={() => exportSelectedSnapshots('csv')} role="menuitem">{t("CSV")}</button>
                    <button onClick={() => exportSelectedSnapshots('json')} role="menuitem">{t("JSON")}</button>
                    <button onClick={exportSelectedScreenshots} role="menuitem">{t("PNG")}</button>
                    <button onClick={exportSelectedMhtml} role="menuitem">{t("MHTML")}</button>
                    <button onClick={exportSelectedSingleFile} role="menuitem">{t("SingleFile HTML")}</button>
                    <button onClick={exportSelectedZip} role="menuitem">{t("ZIP")}</button>
                  </div>
                )}
              </div>
              <button disabled={!selectedSnapshots.size} onClick={deleteSelectedSnapshots} className="icon-button">
                <Trash2 size={14} aria-hidden="true" />
                <span>{t("Delete")}</span>
              </button>
              <button className="icon-button" disabled={!selectedSnapshots.size} onClick={syncSelected}>
                <Upload size={14} aria-hidden="true" />
                <span>{t("Sync")}</span>
              </button>
              <StatusBadge status={savedUrlStatus} />
            </div>
            <div className="saved-url-table-wrap">
              <table className={hasSavedScreenshots ? 'saved-url-table saved-url-table--with-screenshots' : 'saved-url-table'}>
                <thead>
                  <tr>
                    <th className="saved-url-table__check">
                      <input
                        type="checkbox"
                        aria-label={allVisibleSelected ? t("Deselect all visible URLs") : t("Select all visible URLs")}
                        checked={allVisibleSelected}
                        disabled={visibleSnapshotIds.length === 0}
                        onChange={(event) => {
                          const shouldSelect = event.currentTarget.checked;
                          setSelectedSnapshots((current) => {
                            const next = new Set(current);
                            visibleSnapshotIds.forEach((id) => {
                              if (shouldSelect) next.add(id);
                              else next.delete(id);
                            });
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th aria-sort={savedUrlSortKey === 'date' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('date')}>
                        <span>{t("Date Added")}</span>
                        <b>{savedUrlSortIndicator('date')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'url' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('url')}>
                        <span>{t("URL")}</span>
                        <b>{savedUrlSortIndicator('url')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'tags' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('tags')}>
                        <span>{t("Tags")}</span>
                        <b>{savedUrlSortIndicator('tags')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'sync' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('sync')}>
                        <span>{t("Status")}</span>
                        <b>{savedUrlSortIndicator('sync')}</b>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSnapshots.map((snapshot) => {
                    const syncStatus = snapshotSyncStatus(snapshot, server_id, syncStatuses[snapshot.id]);
                    const inlineTagSuggestions = inlineTagEditor?.snapshot_id === snapshot.id
                      ? matchingTagSuggestions(tags, inlineTagEditor.value, snapshot.tags)
                      : [];
                    return (
                      <tr
                        className={highlightedSnapshotId === snapshot.id ? 'snapshot-row--highlighted' : ''}
                        data-highlighted-snapshot={highlightedSnapshotId === snapshot.id ? 'true' : undefined}
                        key={snapshot.id}
                      >
                        <td className="saved-url-table__check">
                          <input type="checkbox" checked={selectedSnapshots.has(snapshot.id)} onChange={() => toggleSnapshot(snapshot.id)} />
                        </td>
                        <td className="saved-url-date">
                          <time dateTime={snapshot.timestamp} title={snapshotDate(snapshot)}>{compactSnapshotDate(snapshot)}</time>
                        </td>
                        <td className="saved-url-main">
                          <div className="saved-url-main-layout">
                            {hasSavedScreenshots ? <SnapshotScreenshotThumb snapshot={snapshot} /> : null}
                            <div className="saved-url-title-row">
                              <div>
                                <SnapshotArchiveTitleLink snapshot={snapshot} />
                                <div className="saved-url-url-row">
                                  <SnapshotFavicon url={snapshot.favIconUrl} />
                                  <a className="snapshot-url" href={snapshot.url} target="_blank" rel="noopener noreferrer">
                                    <code>{snapshot.url}</code>
                                  </a>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="saved-url-links">
                            {(server?.server || '') && <a href={`${(server?.server || '')}/archive/${snapshot.url}`} target="_blank" rel="noopener noreferrer">{t("ArchiveBox")}</a>}
                            <a href={`https://web.archive.org/web/${snapshot.url}`} target="_blank" rel="noopener noreferrer">{t("Archive.org ↗")}</a>
                          </div>
                        </td>
                        <td className="saved-url-tags">
                          <TagList>
                            {snapshot.tags.map((tag) => (
                              <TagChip key={tag} label={tag} onRemove={() => removeSnapshotTag(snapshot, tag)} removeTitle={t("Remove tag $1", tag)} />
                            ))}
                            {inlineTagEditor?.snapshot_id === snapshot.id ? (
                              <TagInputChip
                                value={inlineTagEditor.value}
                                autoFocus
                                placeholder={t("tag")}
                                suggestions={inlineTagSuggestions}
                                onCommit={(tag) => addInlineTag(snapshot, tag)}
                                onCancel={() => setInlineTagEditor(null)}
                                onBlur={() => {
                                  if (!inlineTagEditor.value.trim()) setInlineTagEditor(null);
                                }}
                                onChange={(value) => setInlineTagEditor({ snapshot_id: snapshot.id, value })}
                              />
                            ) : (
                              <TagChip label="+" variant="add" onClick={() => {
                                setInlineTagEditor({ snapshot_id: snapshot.id, value: '' });
                              }} title={t("Add tag")} />
                            )}
                          </TagList>
                        </td>
                        <td className="saved-url-sync">
                          <SnapshotSyncStatus snapshot={snapshot} serverId={server_id} serverName={server?.name || ''} urlStatus={syncStatus} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleSnapshots.length === 0 && <EmptyState title={t("No saved URLs match this view")} detail={t("Save a page with the toolbar button or import URLs from browser history/bookmarks.")} />}
            </div>
          </div>
          <aside className="panel tags-panel">
            <h2>{t("Tags")}</h2>
            {tagCounts.map(([tag, count]) => (
              <button
                key={tag}
                className={filterText.toLowerCase() === tag.toLowerCase() ? 'active' : ''}
                onClick={() => updateSavedUrlFilter(filterText.toLowerCase() === tag.toLowerCase() ? '' : tag)}
              >
                <span>{tag}</span>
                <b>{count}</b>
              </button>
            ))}
          </aside>
        </section>
      )}

      {tab === 'config' && (
        <section className="config-grid">
          <header className="config-heading">
            <div><h1>{t('Configuration')}</h1><p>{t('Choose what to capture, where to send it, and how long to keep it.')}</p></div>
            <span className="config-autosave"><CheckCircle2 size={14} aria-hidden="true" />{t('Changes save automatically')}</span>
          </header>
          <section className="panel config-card" aria-labelledby="connection-heading">
            <div className="config-card-heading"><span className="config-section-icon"><Server size={20} aria-hidden="true" /></span><div><h2 id="connection-heading">{t('Server connection')}</h2><p>{t('Your destination for archived pages and captures.')}</p></div></div>
          {import.meta.env.BROWSER === 'safari' && (
            <p className="help-text">The extension uses the ArchiveBox app server registry until you save a connection here. Cookie sync permissions are configured separately for each server.</p>
          )}
          <Field label={t("ArchiveBox Server URL")}>
            <input aria-label={t("ArchiveBox Server URL")} disabled={savingServer} value={serverDraft ?? server?.server ?? ''} onChange={(event) => setServerDraft(event.currentTarget.value)} onBlur={async () => { if (serverDraft !== null) { await saveServer({ server: serverDraft }); setServerDraft(null); } }} placeholder={t("http://localhost:5797 or https://archivebox.example.com")} />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin`, '_blank')}>{t("Admin")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/login/`, '_blank')}>{t("Login")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testServer}>{t("Test")}</button>
            <StatusBadge status={serverStatus} />
          </Field>
          <p className="help-text">
            {t("The base URL of your self-hosted ArchiveBox server. Local HTTP servers such as")} <code>http://localhost:5797</code> {t("are supported, as are HTTPS deployments.")}
          </p>
          <Field label={t("API Key")}>
            <input aria-label={t("API Key")} type="password" disabled={savingServer} value={tokenDraft ?? server?.token ?? ''} onChange={(event) => setTokenDraft(event.currentTarget.value)} onBlur={async () => { if (tokenDraft !== null) { await saveServer({ token: tokenDraft.trim() }); setTokenDraft(null); } }} placeholder="... abcexamplekey1234 ..." />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/api/apitoken/add/`, '_blank')}>{t("Generate")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testApiKeyValue}>{t("Test")}</button>
            <StatusBadge status={apiStatus} />
          </Field>
          <Field label={t("Default Persona")}>
            <select aria-label="Default Persona" value={server?.persona ?? 'Default'} disabled={!server?.token}
              onChange={(event) => saveServer({ persona: event.currentTarget.value === 'Default' ? null : event.currentTarget.value })}>
              {[...new Set(['Default', ...(server?.persona ? [server.persona] : []), ...server_personas.map((item) => item.name)])].map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </Field>
          {persona_error && <p className="status error">{persona_error}</p>}
          <p className="help-text">The selected server persona is used for popup and automatic submissions. Cookie uploads require separate consent for this server.</p>
          <div className="doc-links">
            <a href="https://github.com/ArchiveBox/archivebox-browser-extension#setup" target="_blank" rel="noopener noreferrer">{t("Extension setup guide")}</a>
            <a href="https://github.com/ArchiveBox/ArchiveBox/wiki/Configuration#public_index--public_snapshots--public_add_view" target="_blank" rel="noopener noreferrer">{t("ArchiveBox server config")}</a>
            <a href="https://demo.archivebox.io/api/v1/docs" target="_blank" rel="noopener noreferrer">{t("REST API docs")}</a>
          </div>
          </section>
          <section className="panel config-card" aria-labelledby="outputs-heading">
            <div className="config-card-heading"><span className="config-section-icon"><HardDrive size={20} aria-hidden="true" /></span><div><h2 id="outputs-heading">{t('Capture & storage')}</h2><p>{t('Choose local captures and uploads for each output type.')}</p></div></div>
            <div className="capture-grid">
              <div className="capture-grid-head" aria-hidden="true"><span>{t('Output type')}</span><span><HardDrive size={13} />{t('Save locally')}</span><span><Upload size={13} />{t('Upload')}</span><span><Clock3 size={13} />{t('Keep locally')}</span></div>
              <div className="capture-output capture-output--metadata">
                <div className="capture-output-name"><span className="capture-output-icon capture-output-icon--metadata"><Database size={21} aria-hidden="true" /></span><div><h3>{t('Snapshot metadata')}</h3><p>{t('URL, title, tags & upload history')}</p></div></div>
                <label className="capture-choice"><span>{t('Save locally')}</span><input className="config-switch" type="checkbox" aria-label={t('Save snapshot metadata locally')} checked={config.save_snapshots_locally} onChange={event => saveConfig({ save_snapshots_locally: event.currentTarget.checked })} /></label>
                <div className="capture-choice"><span>{t('Upload')}</span><div className="capture-metadata-upload" title={t('Metadata is included with every upload')}><CheckCircle2 size={15} aria-hidden="true" />{t('Included')}</div></div>
                <label className="capture-retention"><span>{t('Keep locally')}</span><select aria-label={t('Snapshot metadata retention')} disabled={!config.save_snapshots_locally} value={config.save_snapshots_locally ? config.local_retention_ms : 'uploaded'} onChange={event => saveConfig({ local_retention_ms: event.currentTarget.value === 'never' ? 'never' : Number(event.currentTarget.value) as ConfigState['local_retention_ms'] })}>
                  {!config.save_snapshots_locally && <option value="uploaded">{t('Until uploaded')}</option>}
                  <option value="60000">{t('1 minute')}</option><option value="86400000">{t('1 day')}</option><option value="2592000000">{t('30 days')}</option><option value="7776000000">{t('90 days')}</option><option value="never">{t('never')}</option>
                </select></label>
              </div>
              {([
                { kind: 'viewport_screenshot', icon: Camera, title: t('Viewport screenshot'), detail: t('The visible part of the page · PNG'), local: 'save_viewport_screenshots_locally', upload: 'upload_viewport_screenshots_to_server', localLabel: t('Save viewport screenshots locally'), uploadLabel: t('Upload viewport screenshots to server'), retentionLabel: t('Viewport screenshot retention') },
                { kind: 'screenshot', icon: ScanLine, title: t('Full-page screenshot'), detail: t('The entire page, top to bottom · PNG'), local: 'save_screenshots_locally', upload: 'upload_screenshots_to_server', localLabel: t('Save full-page screenshots locally'), uploadLabel: t('Upload full-page screenshots to server'), retentionLabel: t('Full-page screenshot retention') },
                { kind: 'mhtml', icon: FileCode2, title: t('Web page'), detail: t('HTML and page resources · MHTML'), local: 'save_mhtml_locally', upload: 'upload_mhtml_to_server', localLabel: t('Save MHTML snapshots locally'), uploadLabel: t('Upload MHTML snapshots to server'), retentionLabel: t('MHTML retention') },
              ] as const).map(output => {
                const available = output.kind !== 'mhtml' || supportsMhtmlCapture;
                return <div className="capture-output" key={output.kind}>
                  <div className="capture-output-name"><span className={`capture-output-icon capture-output-icon--${output.kind}`}><output.icon size={21} aria-hidden="true" /></span><div><h3>{output.title}</h3><p>{available ? output.detail : mhtmlUnsupportedMessage()}</p></div></div>
                  <label className="capture-choice"><span>{t('Save locally')}</span><input className="config-switch" type="checkbox" aria-label={output.localLabel} disabled={!available} checked={available && config[output.local]} onChange={event => updateLocalCaptureSetting(output.local, event.currentTarget.checked)} /></label>
                  <label className="capture-choice"><span>{t('Upload')}</span><input className="config-switch" type="checkbox" aria-label={output.uploadLabel} disabled={!available} checked={available && Boolean(server?.policy[output.upload])} onChange={event => saveServer({ policy: { [output.upload]: event.currentTarget.checked } })} /></label>
                  <label className="capture-retention"><span>{t('Keep locally')}</span><select aria-label={output.retentionLabel} disabled={!available} value={config.capture_retention_ms[output.kind] ?? 'snapshot'} onChange={event => {
                    const value = event.currentTarget.value;
                    void saveConfig({ capture_retention_ms: { [output.kind]: value === 'snapshot' ? null : value === 'never' ? 'never' : Number(value) as ConfigState['local_retention_ms'] } });
                  }}>
                    <option value="snapshot">{t('Same as metadata')}</option>
                    {retentionDurations.filter(value => config.local_retention_ms === 'never' || (value !== 'never' && value <= config.local_retention_ms)).map(value => <option key={value} value={value}>{t(value === 'never' ? 'never' : value === 60000 ? '1 minute' : value === 86400000 ? '1 day' : value === 2592000000 ? '30 days' : '90 days')}</option>)}
                  </select></label>
                </div>;
              })}
            </div>
            <StatusBadge status={localCaptureStatus} />
            {config.save_singlefile_locally && <Field label={t('SingleFile retention')}>
              <select aria-label={t('SingleFile retention')} value={config.capture_retention_ms.singlefile ?? 'snapshot'} onChange={event => {
                const value = event.currentTarget.value;
                void saveConfig({ capture_retention_ms: { singlefile: value === 'snapshot' ? null : value === 'never' ? 'never' : Number(value) as ConfigState['local_retention_ms'] } });
              }}><option value="snapshot">{t('Same as metadata')}</option>{retentionDurations.filter(value => config.local_retention_ms === 'never' || (value !== 'never' && value <= config.local_retention_ms)).map(value => <option key={value} value={value}>{t(value === 'never' ? 'never' : value === 60000 ? '1 minute' : value === 86400000 ? '1 day' : value === 2592000000 ? '30 days' : '90 days')}</option>)}</select>
            </Field>}
            <details className="config-cleanup-help"><summary><ShieldCheck size={15} aria-hidden="true" />{t('Safe cleanup: server copies are always kept')}</summary><p>{t('File timers start after confirmed upload. Cleanup verifies the same server still has each file before deleting local data. Unuploaded files are kept. Individual file retention can be shorter than the snapshot default; the snapshot row and upload receipts remain until the snapshot expires.')}</p></details>
          </section>
          <section className="panel config-card" aria-labelledby="automatic-heading">
            <div className="config-card-heading"><span className="config-section-icon"><Zap size={20} aria-hidden="true" /></span><div><h2 id="automatic-heading">{t('Automatic Archiving')}</h2><p>{t('Capture visited pages that match your rules.')}</p></div><label className="config-auto-toggle"><input className="config-switch" type="checkbox" aria-label={t('Enable automatic archiving')} checked={config.enable_auto_archive} onChange={event => updateAutoArchive(event.currentTarget.checked)} /><span>{config.enable_auto_archive ? t('On') : t('Off')}</span></label></div>
          <Field label={t("Match URL regex")}>
            <input aria-label={t("Match URL regex")} value={config.match_urls} onChange={(event) => saveConfig({ match_urls: event.currentTarget.value })} placeholder="(wikipedia.org)|(archive.org)|(github.com/ArchiveBox/ArchiveBox/$)" />
          </Field>
          <p className="help-text">{t("By default, pages are archived only when you click Save to ArchiveBox. Use")} <code>.*</code> {t("to archive all visited pages, though that is not recommended.")}</p>
          <Field label={t("Exclude URL regex")}>
            <input aria-label={t("Exclude URL regex")} value={config.exclude_urls} onChange={(event) => saveConfig({ exclude_urls: event.currentTarget.value })} placeholder="(mail.google.com)|(password)|(login)|(logout)|(signup)|(register)" />
          </Field>
          <p className="help-text">{t("Exclude sensitive pages like inboxes, forms, corporate documents, banking sites, login/logout flows, and password pages.")}</p>
          <Field label={t("Test URL")}>
            <input
              aria-label={t("Test URL")}
              value={testUrl}
              onChange={(event) => setTestUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  testUrlPatterns();
                }
              }}
              placeholder="https://example.com/article"
            />
            <button onClick={testUrlPatterns}>{t("Submit Test")}</button>
            <StatusBadge status={testStatus} />
          </Field>
          </section>
          <section className="panel config-card" aria-labelledby="preferences-heading">
            <div className="config-card-heading"><span className="config-section-icon"><Settings2 size={20} aria-hidden="true" /></span><div><h2 id="preferences-heading">{t('Extension preferences')}</h2><p>{t('Language and browser access.')}</p></div></div>
            <div className="config-preferences">
          <Field label={t("Language")}>
            <select aria-label={t("Language")} value={config.ui_language} onChange={(event) => saveConfig({ ui_language: event.currentTarget.value as ConfigState['ui_language'] })}>
              <option value="auto">{t("Browser default ($1)", browserLanguage)}</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="zh_CN">中文（简体）</option>
            </select>
          </Field>
              <div className="field"><span>{t('Browser permissions')}</span><div><button disabled={requestingPermissions} onClick={requestAllPermissions}><ShieldCheck size={15} aria-hidden="true" />{t('Request all permissions')}</button><StatusBadge status={permissionsStatus} /></div></div>
            </div>
          </section>
        </section>
      )}

      {tab === 'profiles' && (
        <section className="panel cookies-panel">
          <div className="cookies-heading">
            <div className="cookies-heading-title"><Cookie size={19} aria-hidden="true" /><h2>{t('Cookies & profiles')}</h2></div>
            <button onClick={createPersona}><Plus size={15} aria-hidden="true" />{t('New Profile')}</button>
          </div>
          <div className="persona-tabs" role="tablist" aria-label={t('Archiving profiles')}>
            {personas.map((persona, index) => <button key={persona.id} id={`persona-tab-${persona.id}`} role="tab" aria-label={persona.name} title={persona.name}
              aria-selected={viewedPersona?.id === persona.id} aria-controls="persona-panel" tabIndex={viewedPersona?.id === persona.id ? 0 : -1}
              onClick={() => { setViewedPersonaId(persona.id); setPersonaStatus({ kind: 'idle', text: '' }); }}
              onKeyDown={event => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % personas.length;
                else if (event.key === 'ArrowLeft') next = (index - 1 + personas.length) % personas.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = personas.length - 1;
                else return;
                event.preventDefault(); setViewedPersonaId(personas[next]!.id);
                document.getElementById(`persona-tab-${personas[next]!.id}`)?.focus();
              }}>
              <UserRoundCog size={15} aria-hidden="true" /><span>{persona.name}</span>
              {persona.id === active_persona && <span className="persona-active-dot" title={t('Used for archiving')} />}
              <small aria-hidden="true">{groupCookieSites(persona.cookies || {}).length}</small>
            </button>)}
          </div>
          {viewedPersona && (() => {
            const persona = viewedPersona;
            const syncState = cookieSyncStates[`${server_id}:${persona.id}`];
            const sameServer = syncState?.server_origin === archiveboxServerBaseUrl;
            const autoSync = !!syncState && sameServer && syncState.enabled !== false;
            const syncing = syncingPersonas.has(persona.id);
            const cookieCount = savedCookieSites.reduce((sum, site) => sum + site.cookieCount, 0);
            return <article className={`persona${persona.id === active_persona ? ' active' : ''}`} key={persona.id} id="persona-panel" role="tabpanel" aria-labelledby={`persona-tab-${persona.id}`}>
              <div className="persona-overview">
                <div className="persona-identity"><input aria-label={t('Profile name')} value={persona.name} onChange={event => savePersona(persona, { name: event.currentTarget.value })} />
                  <span>{t('$1 sites', savedCookieSites.length)}<span aria-hidden="true"> · </span>{t('$1 cookies', cookieCount)}</span></div>
                <div className="persona-actions">
                  {persona.id === active_persona ? <span className="persona-current"><CheckCircle2 size={14} aria-hidden="true" />{t('Used for archiving')}</span>
                    : <button onClick={() => chooseActivePersona(persona)}>{t('Use for archiving')}</button>}
                  <button className="cookie-icon-button" title={t('Export cookies.txt')} aria-label={t('Export cookies.txt')} onClick={() => copyPersonaCookies(persona)}><Download size={16} aria-hidden="true" /></button>
                  <button className="cookie-icon-button" title={t('Delete profile')} aria-label={t('Delete profile')} onClick={() => deletePersona(persona.id)}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              </div>
              <div className="persona-sync-bar">
                <label className="toggle"><input type="checkbox" checked={autoSync || syncing} disabled={!server?.token || syncing}
                  onChange={event => togglePersonaSync(persona, event.currentTarget.checked)} />{t('Auto-sync')}</label>
                <span className="persona-sync-destination" title={server?.server || t('Connect a server in Configuration')}>{server?.name || t('No server connected')}</span>
                <span className="persona-sync-time" role="status"><Clock3 size={13} aria-hidden="true" />{sameServer && syncState?.last_synced_at
                    ? <span>{t('Last synced')} <time dateTime={syncState.last_synced_at} title={new Date(syncState.last_synced_at).toLocaleString()}>{new Date(syncState.last_synced_at).toLocaleTimeString()}</time></span>
                    : t('Never synced')}</span>
                {persona.remote_personas?.[server_id]?.url && <a className="persona-sync-link persona-sync-link--synced" href={persona.remote_personas[server_id]!.url} target="_blank" rel="noopener noreferrer" title={t('Open ArchiveBox persona')} aria-label={t('Open ArchiveBox persona')}><ExternalLink size={14} aria-hidden="true" /></a>}
                <button aria-label={t('Sync now')} disabled={!server?.token || syncing} onClick={() => syncPersona(persona)}><RefreshCw size={14} className={syncing || (autoSync && syncState?.pending) ? 'is-spinning' : ''} aria-hidden="true" />{syncing ? t('Syncing…') : t('Sync now')}</button>
              </div>
              {syncState && !sameServer && <p role="status" className="status warning">{t('Cookie sync paused: sync this profile to the new server manually.')}</p>}
              {autoSync && syncState?.error && <p role="status" className="status error">{t('Cookie sync failed; retrying automatically: $1', syncState.error)}</p>}
              <div className="persona-details-row">
                <details className="persona-settings"><summary><Settings2 size={13} aria-hidden="true" />{t('Browser settings')}<span>{[persona.settings.language, persona.settings.timezone].filter(Boolean).join(' · ')}</span></summary>
                  <div className="settings-grid">
                    {([
                      ['userAgent', t('User Agent')], ['geography', t('Geography')],
                      ['timezone', t('Timezone')], ['language', t('Language')], ['operatingSystem', t('Operating System')],
                      ['viewport', t('Viewport Size')], ['viewportScale', t('CSS Pixel Scale')], ['colorScheme', t('Color Scheme')],
                    ] satisfies Array<[EditablePersonaSettingKey, string]>).map(([key, label]) => <label key={key}><span>{label}</span>
                      {key === 'colorScheme' ? <select value={persona.settings[key] || ''} onChange={event => updatePersonaSetting(persona, key, event.currentTarget.value)}>
                        <option value="">{t('Not set')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option>
                      </select> : <input value={persona.settings[key] || ''} onChange={event => updatePersonaSetting(persona, key, event.currentTarget.value)} />}
                    </label>)}
                  </div>
                  <button onClick={() => detectPersonaSettings(persona)}><RefreshCw size={13} aria-hidden="true" />{t('Detect Settings')}</button>
                </details>
              </div>
            </article>;
          })()}
          <StatusBadge status={personaStatus} />
          <div className="cookie-library-heading"><span>{t('Select sites to add · Expand for individual domains')}</span>
            <button disabled={cookiesLoading} onClick={() => loadCookies()}><RefreshCw size={13} className={cookiesLoading ? 'is-spinning' : ''} aria-hidden="true" />{cookiesLoading ? t('Loading…') : cookiesLoaded ? t('Refresh cookies') : t('Load Browser Cookies')}</button>
          </div>
          <StatusBadge status={cookieStatus} />
          <CookieSitePicker cookies={{ ...viewedPersona?.cookies, ...cookiesByDomain }} selected={selectedCookieDomains} setSelected={setSelectedCookieDomains} cachedIcons={cachedCookieIcons}
            savedDomains={new Set(Object.keys(viewedPersona?.cookies || {}))} loaded={cookiesLoaded} onCopy={copyDomainCookies} onRemove={domain => viewedPersona && removePersonaDomain(viewedPersona, domain)} />
          {selectedCookieDomains.size > 0 && <div className="cookie-selection-bar">
            <span><Cookie size={16} aria-hidden="true" /><strong>{selectedCookieDomains.size === 1 ? t('1 domain selected') : t('$1 domains selected', selectedCookieDomains.size)}</strong></span>
            <button className="cookie-add-button" disabled={!viewedPersona || selectedCookieDomains.size === 0 || syncingPersonas.has(viewedPersona.id)} onClick={() => viewedPersona && importSelectedCookies(viewedPersona.id)}>
              <Plus size={16} aria-hidden="true" />{t('Add to $1', viewedPersona?.name || t('profile'))}
            </button>
          </div>}
        </section>
      )}

      {tab === 'import' && (
        <section className="panel">
          <SectionHeader title={t("Bulk Import URLs")} detail={t("Import URLs from browser history or bookmarks into the saved URL list.")} />
          <details open={!supportsDirectBrowserImport}>
            <summary>{t('Import a Safari export')}</summary>
            <p>{t('Safari requires a file export to import existing bookmarks, Reading List, or history. On Mac, choose File → Export Browsing Data to File. On iPhone or iPad, open Settings → Apps → Safari → Export. Select Bookmarks, Reading List, and History as available.')}</p>
            <p>{t('Choose the data and history dates below, then select the exported ZIP, bookmark HTML, or history JSON files. Files are read locally; only URLs you select are imported. Passwords and payment cards are ignored.')}</p>
            <div className="toolbar">
              <label>{t('Safari data to import')}
                <select value={safariImportSource} disabled={importLoading} onChange={event => setSafariImportSource(event.currentTarget.value as SafariImportSource)}>
                  <option value="all">{t('Bookmarks, Reading List, and History')}</option>
                  <option value="bookmarks">{t('Bookmarks')}</option>
                  <option value="readingList">{t('Reading List')}</option>
                  <option value="history">{t('History')}</option>
                </select>
              </label>
              <label>{t('Import Safari Export')}
                <input type="file" accept=".zip,.html,.htm,.json" multiple disabled={importLoading} onChange={event => {
                  const files = Array.from(event.currentTarget.files || []);
                  event.currentTarget.value = '';
                  void loadSafariFiles(files);
                }} />
              </label>
            </div>
          </details>
          <div className="toolbar">
            {supportsDirectBrowserImport && <>
              <button disabled={importLoading} onClick={loadHistory}>{t("Import from Browser History")}</button>
              <button disabled={importLoading} onClick={loadBookmarks}>{t("Import from Browser Bookmarks")}</button>
              <button disabled={importLoading} onClick={loadTabManagerPlus}>{t("Import from Tab Manager Plus")}</button>
            </>}
            <input type="date" aria-label={t('History start date')} disabled={importLoading} value={importStartDate} onChange={(event) => setImportStartDate(event.currentTarget.value)} />
            <input type="date" aria-label={t('History end date')} disabled={importLoading} value={importEndDate} onChange={(event) => setImportEndDate(event.currentTarget.value)} />
            <label className="search-field">
              <Search size={14} aria-hidden="true" />
              <input value={importFilter} onChange={(event) => setImportFilter(event.currentTarget.value)} placeholder={t("Filter URLs and titles")} />
            </label>
            <label className="toggle"><input type="checkbox" checked={showNewOnly} onChange={(event) => setShowNewOnly(event.currentTarget.checked)} /> {t("Show new only")}</label>
            <input value={importTags} onChange={(event) => setImportTags(event.currentTarget.value)} placeholder={t("tags,comma,separated")} />
            <button disabled={!importItems.some((item) => item.selected)} onClick={importSelectedUrls}>{t("Import Selected ($1)", visibleSelectedImportCount)}</button>
            <StatusBadge status={importStatus} />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t("Select all visible import URLs")}
                    checked={filteredImportItems.length > 0 && filteredImportItems.filter((item) => item.isNew).every((item) => item.selected)}
                    onChange={(event) => setAllVisibleImportItems(event.currentTarget.checked)}
                  />
                </th>
                <th>{t("URL")}</th>
                <th>{t("Title")}</th>
                <th>{t("Timestamp")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredImportItems.map((item) => (
                <tr className={item.isNew ? '' : 'muted'} key={item.id}>
                  <td><input type="checkbox" checked={item.selected} disabled={!item.isNew} onChange={() => setImportItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, selected: !candidate.selected } : candidate))} /></td>
                  <td data-label={t("URL")}><code>{item.url}</code></td>
                  <td data-label={t("Title")}>{item.title}</td>
                  <td data-label={t("Timestamp")}>{snapshotDate(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {importItems.length === 0 && <EmptyState title={t("No import source loaded")} detail={supportsDirectBrowserImport ? t("Choose browser history or bookmarks to review URLs before importing.") : t('Choose a Safari export file to review URLs before importing.')} />}
        </section>
      )}

      {editingTags && (
          <dialog className="modal" ref={tagDialogRef} aria-label={t("Edit Tags")}>
            <h2>{t("Edit Tags")}</h2>
            <div className="tag-line">
              {modalTags.map((tag) => <button type="button" key={tag} onClick={() => setModalTags(modalTags.filter((item) => item !== tag))}>{tag} ×</button>)}
            </div>
            <div className="toolbar">
              <TagInputChip
                value={newTag}
                placeholder={t("Add tag")}
                suggestions={modalTagSuggestions}
                onCommit={addModalTag}
                onChange={setNewTag}
              />
              <button type="button" onClick={() => {
                addModalTag(newTag);
              }}>{t("Add")}</button>
            </div>
            <footer className="modal-actions">
              <button type="button" className="modal-button modal-button--cancel" onClick={closeTagEditor}>{t("cancel")}</button>
              <span>{t("Selected snapshots: $1", selectedSnapshots.size)}</span>
              <button type="button" className="modal-button modal-button--primary" onClick={saveTagChanges}>{t("Save Changes")}</button>
            </footer>
          </dialog>
      )}
      <footer className="footer-links">
        <a href="https://github.com/ArchiveBox/archivebox-browser-extension" target="_blank" rel="noopener noreferrer">{t("Extension documentation")}</a>
        <a href="https://github.com/ArchiveBox/ArchiveBox/wiki" target="_blank" rel="noopener noreferrer">{t("ArchiveBox documentation")}</a>
        <a href="https://chromewebstore.google.com/detail/archivebox-exporter/habonpimjphpdnmcfkaockjnffodikoj?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">{t("Chrome extension details")}</a>
        <a href="https://github.com/ArchiveBox/archivebox-browser-extension/issues" target="_blank" rel="noopener noreferrer">{t("Report an issue")}</a>
        <a href="https://zulip.archivebox.io" target="_blank" rel="noopener noreferrer">{t("Support forum")}</a>
      </footer>
    </main>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (!status.text) return null;
  return <span className={`status ${status.kind}`}>{status.text}</span>;
}
