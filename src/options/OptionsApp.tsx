import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Database,
  Download,
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
import { addToArchiveBox } from '@/src/lib/archivebox';
import { defaultSingleFileExtensionId, defaultTabManagerPlusExtensionId, mhtmlUnsupportedMessage, singleFileCaptureUnavailableMessage, supportsMhtmlCapture } from '@/src/lib/browserCapabilities';
import { loadBookmarkSnapshots, loadHistorySnapshots } from '@/src/lib/browserData';
import { formatCookiesForExport, getCookiesByDomain } from '@/src/lib/cookies';
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
import {
  defaultConfig,
  defaultPersona,
  ensurePersonas,
  getConfig,
  getPersonas,
  getSnapshots,
  setActivePersona,
  setConfig,
  setPersonas,
  setSnapshots,
} from '@/src/lib/storage';
import type { ConfigState, Persona, RuntimeMessage, RuntimeResponse, Snapshot, StoredCookie } from '@/src/lib/types';

type Tab = 'urls' | 'config' | 'profiles' | 'import';
type Status = { kind: 'idle' | 'success' | 'error' | 'warning'; text: string };
type ImportItem = Snapshot & { selected: boolean; isNew: boolean };
type PersonaSettingKey = keyof Persona['settings'];
type SavedUrlSortKey = 'date' | 'url' | 'tags' | 'sync';
type SortDirection = 'asc' | 'desc';
type OptionTab = { id: Tab; label: string; Icon: LucideIcon };
type LocalCaptureConfigKey = 'save_screenshots_locally' | 'save_mhtml_locally' | 'save_singlefile_locally';
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

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS')) return 'iOS';
  return t("Unknown");
}

async function detectGeography(): Promise<string> {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json() as { city?: string; country_name?: string };
    return [data.city, data.country_name].filter(Boolean).join(', ') || t("Unknown");
  } catch {
    return t("Unknown");
  }
}

async function currentPersonaSettings() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    operatingSystem: detectOS(),
    geography: await detectGeography(),
  };
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
  return value.trim().replace(/\/+$/, '');
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
    readSnapshotScreenshotBlob(snapshot.screenshot).then((blob) => {
      if (!blob || cancelled) return;
      nextObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(nextObjectUrl);
    });
    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [snapshot.screenshot?.path]);

  if (!objectUrl) {
    return <span className="snapshot-screenshot-placeholder" aria-hidden="true" />;
  }

  return (
    <a
      className="snapshot-screenshot-link"
      href={extensionUrl(`/options.html?screenshot=${encodeURIComponent(snapshot.id)}`)}
      target="_blank"
      rel="noopener noreferrer"
      title={t("Open local screenshot: $1", snapshot.screenshot?.path || '')}
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

function MhtmlViewer({ snapshotId }: { snapshotId: string }) {
  const [state, setState] = useState<MhtmlViewerState>({ loading: true });
  const [frameLoadCount, setFrameLoadCount] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMhtml() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshotId);
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
  }, [snapshotId]);

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

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshotId)}`);
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

function SingleFileViewer({ snapshotId }: { snapshotId: string }) {
  const [state, setState] = useState<HtmlViewerState>({ loading: true });

  useEffect(() => {
    let cancelled = false;

    async function loadSingleFile() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshotId);
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
  }, [snapshotId]);

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

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshotId)}`);
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

function ScreenshotViewer({ snapshotId }: { snapshotId: string }) {
  const [state, setState] = useState<ScreenshotViewerState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    let objectUrls: string[] = [];

    async function loadScreenshot() {
      setState({ loading: true });
      try {
        const snapshots = await getSnapshots();
        const snapshot = snapshots.find((item) => item.id === snapshotId);
        if (!snapshot) throw new Error(t("Saved URL not found"));
        const blobs = await readSnapshotScreenshotBlobs(snapshot.screenshot);
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
  }, [snapshotId]);

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

  const backUrl = extensionUrl(`/options.html?highlight=${encodeURIComponent(snapshotId)}`);
  const title = state.title || state.snapshot?.title || t("Screenshot");
  const screenshot = state.snapshot?.screenshot;
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

  const params = new URLSearchParams(window.location.search);
  const screenshotSnapshotId = params.get('screenshot');
  if (screenshotSnapshotId) {
    return <ScreenshotViewer snapshotId={screenshotSnapshotId} />;
  }
  const mhtmlSnapshotId = params.get('mhtml');
  if (mhtmlSnapshotId) {
    return <MhtmlViewer snapshotId={mhtmlSnapshotId} />;
  }
  const singleFileSnapshotId = params.get('singlefile');
  if (singleFileSnapshotId) {
    return <SingleFileViewer snapshotId={singleFileSnapshotId} />;
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
  const [savedUrlStatus, setSavedUrlStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [importStatus, setImportStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [cookieStatus, setCookieStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [personaStatus, setPersonaStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [syncStatuses, setSyncStatuses] = useState<Record<string, Status>>({});
  const [personas, setPersonasState] = useState<Persona[]>([]);
  const [activePersona, setActivePersonaState] = useState('');
  const [cookiesByDomain, setCookiesByDomain] = useState<Record<string, StoredCookie[]>>({});
  const [selectedCookieDomains, setSelectedCookieDomains] = useState<Set<string>>(new Set());
  const [cookieFilter, setCookieFilter] = useState('');
  const [cookieProfileMenuOpen, setCookieProfileMenuOpen] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importFilter, setImportFilter] = useState('');
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [importStartDate, setImportStartDate] = useState(dateInputValue(yesterday));
  const [importEndDate, setImportEndDate] = useState(dateInputValue(today));
  const [importTags, setImportTags] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [inlineTagEditor, setInlineTagEditor] = useState<{ snapshotId: string; value: string } | null>(null);
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
    setPersonasState(personaState.personas);
    setActivePersonaState(personaState.activePersona);
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
    window.addEventListener('popstate', restoreFilterFromUrl);
    return () => window.removeEventListener('popstate', restoreFilterFromUrl);
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
        const aStatus = syncStatuses[a.id]?.text || syncStatuses[a.id]?.kind || 'idle';
        const bStatus = syncStatuses[b.id]?.text || syncStatuses[b.id]?.kind || 'idle';
        comparison = aStatus.toLowerCase().localeCompare(bStatus.toLowerCase());
      }
      return comparison * direction;
    });
  }, [filterText, savedUrlSortDirection, savedUrlSortKey, snapshots, syncStatuses]);
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
  const hasSavedScreenshots = useMemo(() => snapshots.some((snapshot) => Boolean(snapshot.screenshot?.path)), [snapshots]);
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

  const filteredCookies = useMemo(() => {
    const lowered = cookieFilter.toLowerCase();
    return Object.entries(cookiesByDomain)
      .filter(([domain]) => domain.toLowerCase().includes(lowered))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [cookiesByDomain, cookieFilter]);

  const activePersonaStats = useMemo(() => {
    const persona = personas.find((item) => item.id === activePersona);
    if (!persona) return t("No active profile selected");
    const domains = Object.keys(persona.cookies || {});
    const cookieCount = Object.values(persona.cookies || {}).reduce((sum, cookies) => sum + cookies.length, 0);
    return t("$1 domains / $2 cookies", domains.length, cookieCount);
  }, [activePersona, personas]);

  const archiveboxServerUrlIsValid = isHttpUrl(config.archivebox_server_url);
  const archiveboxServerBaseUrl = serverUrlBase(config.archivebox_server_url);

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
      const blobs = await readSnapshotScreenshotBlobs(snapshot.screenshot);
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

  async function persistSnapshots(nextSnapshots: Snapshot[]) {
    setSnapshotsState(nextSnapshots);
    await setSnapshots(nextSnapshots);
  }

  function toggleSnapshot(id: string) {
    setSelectedSnapshots((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateSnapshotTags(snapshotId: string, tags: string[], message: string) {
    const nextSnapshots = snapshots.map((snapshot) => (
      snapshot.id === snapshotId ? { ...snapshot, tags } : snapshot
    ));
    await persistSnapshots(nextSnapshots);
    setSavedUrlStatus({ kind: 'success', text: message });
  }

  async function addInlineTag(snapshot: Snapshot, selectedTag?: string) {
    const tag = selectedTag || (inlineTagEditor?.snapshotId === snapshot.id ? inlineTagEditor.value.trim() : '');
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

  async function saveConfig(patch: Partial<ConfigState>) {
    const next = { ...config, ...patch };
    if (patch.ui_language) setUiLanguage(patch.ui_language);
    setConfigState(next);
    await setConfig(patch);
  }

  function waitForPermissionExplanation(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  async function testServer() {
    if (!archiveboxServerUrlIsValid) {
      setServerStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
      return;
    }
    setServerStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to this server URL so it can test the connection.") });
    await waitForPermissionExplanation();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'test_server_url',
      serverUrl: archiveboxServerBaseUrl,
    });
    setServerStatus(response.ok
      ? { kind: 'success', text: t("Server is reachable") }
      : { kind: 'error', text: response.error || t("Server test failed") });
  }

  async function testApiKeyValue() {
    if (!archiveboxServerUrlIsValid) {
      setApiStatus({ kind: 'warning', text: t("Enter a valid http:// or https:// server URL") });
      return;
    }
    setApiStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to this server URL so it can test the API key.") });
    await waitForPermissionExplanation();
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'test_api_key',
      serverUrl: archiveboxServerBaseUrl,
      apiKey: config.archivebox_api_key,
    });
    setApiStatus(response.ok
      ? { kind: 'success', text: t("API key is valid: user_id = $1", response.user_id || '') }
      : { kind: 'error', text: response.error || t("API key test failed") });
  }

  async function testUrlPatterns() {
    const url = testUrl.trim();
    if (!url) {
      setTestStatus({ kind: 'error', text: t("Please enter a URL to test") });
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
      await waitForPermissionExplanation();
      await addToArchiveBox([url], ['test']);
      setTestStatus({ kind: 'success', text: t("URL was submitted to ArchiveBox") });
      setTestUrl('');
    } catch (error) {
      setTestStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  async function updateAutoArchive(enabled: boolean) {
    if (enabled) {
      setTestStatus({ kind: 'idle', text: t("Automatic archiving needs tabs and site access so it can detect matching pages as you browse.") });
      await waitForPermissionExplanation();
      const granted = await browser.permissions.request({
        permissions: ['tabs'],
        origins: ['<all_urls>'],
      });
      if (!granted) return;
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
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['pageCapture'] }).catch(() => false);
    if (!granted) {
      setLocalCaptureStatus({ kind: 'error', text: t("MHTML capture permission denied") });
      return false;
    }
    return true;
  }

  async function requestScreenshotCapturePermission(): Promise<boolean> {
    setLocalCaptureStatus({ kind: 'idle', text: t("Full-page screenshots need scripting permission only to scroll the current tab and restore it after capture.") });
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['scripting'] }).catch(() => false);
    if (!granted) {
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

  async function loadCookies() {
    setCookieStatus({ kind: 'idle', text: t("Cookie import needs cookie and site access so selected login cookies can be copied into an archiving profile.") });
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({
      permissions: ['cookies'],
      origins: ['*://*/*'],
    });
    if (!granted) {
      setCookieStatus({ kind: 'error', text: t("Cookie permission denied") });
      return;
    }
    const nextCookies = await getCookiesByDomain();
    setCookiesByDomain(nextCookies);
    setCookieStatus({ kind: 'success', text: t("Loaded cookies for $1 domains", Object.keys(nextCookies).length) });
  }

  async function importSelectedCookies(targetPersonaId: string) {
    const targetPersona = personas.find((persona) => persona.id === targetPersonaId);
    if (!targetPersona) {
      setCookieStatus({ kind: 'warning', text: t("Select a profile to copy cookies into") });
      setCookieProfileMenuOpen(false);
      return;
    }
    if (selectedCookieDomains.size === 0) {
      setCookieStatus({ kind: 'warning', text: t("No cookie domains selected") });
      setCookieProfileMenuOpen(false);
      return;
    }
    const selectedCount = selectedCookieDomains.size;
    const nextPersonas = personas.map((persona) => {
      if (persona.id !== targetPersonaId) return persona;
      const cookies = { ...persona.cookies };
      selectedCookieDomains.forEach((domain) => {
        cookies[domain] = cookiesByDomain[domain] || [];
      });
      return { ...persona, cookies, lastUsed: new Date().toISOString() };
    });
    setPersonasState(nextPersonas);
    setSelectedCookieDomains(new Set());
    setCookieProfileMenuOpen(false);
    await setPersonas(nextPersonas);
    const persona = nextPersonas.find((item) => item.id === targetPersonaId);
    setCookieStatus({
      kind: 'success',
      text: t("Copied $1 domain cookies to $2", selectedCount, persona?.name || targetPersona.name),
    });
  }

  function setAllVisibleCookies(selected: boolean) {
    const domains = filteredCookies.map(([domain]) => domain);
    setSelectedCookieDomains((current) => {
      const next = new Set(current);
      domains.forEach((domain) => {
        if (selected) next.add(domain);
        else next.delete(domain);
      });
      return next;
    });
  }

  async function createPersona() {
    const name = prompt(t("Enter name for new profile:"));
    if (!name) return;
    const persona = {
      ...defaultPersona(name),
      settings: await currentPersonaSettings(),
    };
    const nextPersonas = [...personas, persona];
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
    setPersonaStatus({ kind: 'success', text: t("Created profile \"$1\"", name) });
  }

  async function savePersona(persona: Persona, patch: Partial<Persona>) {
    const nextPersonas = personas.map((item) => item.id === persona.id ? { ...item, ...patch } : item);
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
  }

  async function deletePersona(id: string) {
    if (!confirm(t("Delete this profile? This cannot be undone."))) return;
    const nextPersonas = personas.filter((persona) => persona.id !== id);
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
    if (activePersona === id) {
      const nextActive = nextPersonas[0]?.id || '';
      setActivePersonaState(nextActive);
      await setActivePersona(nextActive);
    }
    setPersonaStatus({ kind: 'success', text: t("Profile deleted") });
  }

  async function chooseActivePersona(id: string) {
    setActivePersonaState(id);
    await setActivePersona(id);
  }

  async function detectPersonaSettings(persona: Persona) {
    await savePersona(persona, {
      settings: await currentPersonaSettings(),
    });
    setPersonaStatus({ kind: 'success', text: t("Updated browser settings for $1", persona.name) });
  }

  async function updatePersonaSetting(persona: Persona, key: PersonaSettingKey, value: string) {
    await savePersona(persona, {
      settings: {
        ...persona.settings,
        [key]: value,
      },
    });
  }

  async function removePersonaDomain(persona: Persona, domain: string) {
    const cookies = { ...persona.cookies };
    delete cookies[domain];
    await savePersona(persona, { cookies });
  }

  async function loadHistory() {
    setImportStatus({ kind: 'idle', text: t("History import needs history permission so browser history URLs can be added to the saved URL list.") });
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['history'] });
    if (!granted) {
      setImportStatus({ kind: 'error', text: t("History permission denied") });
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
    setImportStatus({ kind: 'idle', text: t("Bookmark import needs bookmarks permission so bookmark URLs can be added to the saved URL list.") });
    await waitForPermissionExplanation();
    const granted = await browser.permissions.request({ permissions: ['bookmarks'] });
    if (!granted) {
      setImportStatus({ kind: 'error', text: t("Bookmark permission denied") });
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
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tags: [...new Set([...snapshot.tags, ...tagsToAdd])],
    }));
    const latestSnapshots = await getSnapshots();
    const nextSnapshots = [...latestSnapshots, ...imported];
    await persistSnapshots(nextSnapshots);
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
    setSavedUrlStatus({ kind: 'idle', text: t("ArchiveBox needs permission to connect to your configured server so it can sync selected URLs.") });
    await waitForPermissionExplanation();
    setSavedUrlStatus({ kind: 'idle', text: t("Syncing $1 snapshots...", selected.length) });
    for (const snapshot of selected) {
      setSyncStatuses((current) => ({
        ...current,
        [snapshot.id]: { kind: 'warning', text: t("Syncing...") },
      }));
      try {
        await addToArchiveBox([snapshot.url], snapshot.tags);
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'success', text: t("Synced") },
        }));
      } catch (error) {
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'error', text: (error as Error).message },
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setSavedUrlStatus({ kind: 'success', text: t("Finished syncing $1 snapshots", selected.length) });
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
    const nextSnapshots = snapshots.map((snapshot) => selectedSnapshots.has(snapshot.id)
      ? { ...snapshot, tags: modalTags }
      : snapshot);
    await persistSnapshots(nextSnapshots);
    setEditingTags(false);
    setSavedUrlStatus({ kind: 'success', text: t("Updated tags on $1 snapshots", selectedSnapshots.size) });
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
              <button disabled={!selectedSnapshots.size} onClick={async () => {
                if (!confirm(t("Delete $1 snapshots?", selectedSnapshots.size))) return;
                await persistSnapshots(snapshots.filter((snapshot) => !selectedSnapshots.has(snapshot.id)));
                setSelectedSnapshots(new Set());
                setSavedUrlStatus({ kind: 'success', text: t("Deleted selected snapshots") });
              }} className="icon-button">
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
                    const syncStatus = syncStatuses[snapshot.id];
                    const inlineTagSuggestions = inlineTagEditor?.snapshotId === snapshot.id
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
                            {config.archivebox_server_url && <a href={`${config.archivebox_server_url}/archive/${snapshot.url}`} target="_blank" rel="noopener noreferrer">{t("ArchiveBox")}</a>}
                            <a href={`https://web.archive.org/web/${snapshot.url}`} target="_blank" rel="noopener noreferrer">{t("Archive.org ↗")}</a>
                          </div>
                        </td>
                        <td className="saved-url-tags">
                          <TagList>
                            {snapshot.tags.map((tag) => (
                              <TagChip key={tag} label={tag} onRemove={() => removeSnapshotTag(snapshot, tag)} removeTitle={t("Remove tag $1", tag)} />
                            ))}
                            {inlineTagEditor?.snapshotId === snapshot.id ? (
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
                                onChange={(value) => setInlineTagEditor({ snapshotId: snapshot.id, value })}
                              />
                            ) : (
                              <TagChip label="+" variant="add" onClick={() => {
                                setInlineTagEditor({ snapshotId: snapshot.id, value: '' });
                              }} title={t("Add tag")} />
                            )}
                          </TagList>
                        </td>
                        <td className="saved-url-sync">
                          <SyncStatusIcon status={syncStatus} />
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
        <section className="panel config-grid">
          <SectionHeader title={t("Configuration")} detail={t("Connect the extension to your self-hosted ArchiveBox server.")} />
          <Field label={t("Language")}>
            <select value={config.ui_language} onChange={(event) => saveConfig({ ui_language: event.currentTarget.value as ConfigState['ui_language'] })}>
              <option value="auto">{t("Browser default ($1)", browserLanguage)}</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="zh_CN">中文（简体）</option>
            </select>
          </Field>
          <Field label={t("ArchiveBox Server URL")}>
            <input value={config.archivebox_server_url} onChange={(event) => saveConfig({ archivebox_server_url: event.currentTarget.value })} placeholder={t("http://localhost:8000 or https://archivebox.example.com")} />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin`, '_blank')}>{t("Admin")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/login/`, '_blank')}>{t("Login")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testServer}>{t("Test")}</button>
            <StatusBadge status={serverStatus} />
          </Field>
          <p className="help-text">
            {t("The base URL of your self-hosted ArchiveBox server. Local HTTP servers such as")} <code>http://localhost:8000</code> {t("are supported, as are HTTPS deployments.")}
          </p>
          <Field label={t("API Key")}>
            <input value={config.archivebox_api_key} onChange={(event) => saveConfig({ archivebox_api_key: event.currentTarget.value.trim() })} placeholder="... abcexamplekey1234 ..." />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/api/apitoken/add/`, '_blank')}>{t("Generate")}</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testApiKeyValue}>{t("Test")}</button>
            <StatusBadge status={apiStatus} />
          </Field>
          <div className="notice">
            {t("API keys are supported by ArchiveBox v0.8.5 and newer. For older servers, leave this blank and stay logged into the ArchiveBox admin UI in this browser. Public unauthenticated adding is possible server-side, but it is a security risk.")}
          </div>
          <div className="doc-links">
            <a href="https://github.com/ArchiveBox/archivebox-browser-extension#setup" target="_blank" rel="noopener noreferrer">{t("Extension setup guide")}</a>
            <a href="https://github.com/ArchiveBox/ArchiveBox/wiki/Configuration#public_index--public_snapshots--public_add_view" target="_blank" rel="noopener noreferrer">{t("ArchiveBox server config")}</a>
            <a href="https://demo.archivebox.io/api/v1/docs" target="_blank" rel="noopener noreferrer">{t("REST API docs")}</a>
          </div>
          <div className="section-divider" />
          <SectionHeader title={t("Advanced Archiving")} detail={t("Control local captures and automatic archiving behavior.")} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.save_screenshots_locally}
              onChange={(event) => updateLocalCaptureSetting('save_screenshots_locally', event.currentTarget.checked)}
            />
            {t("Save full-page screenshots locally")}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={supportsMhtmlCapture && config.save_mhtml_locally}
              disabled={!supportsMhtmlCapture}
              onChange={(event) => updateLocalCaptureSetting('save_mhtml_locally', event.currentTarget.checked)}
            />
            {t("Save MHTML snapshots locally")}
          </label>
          {!supportsMhtmlCapture ? (
            <p className="help-text">{mhtmlUnsupportedMessage()}</p>
          ) : null}
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.save_singlefile_locally}
              onChange={(event) => updateLocalCaptureSetting('save_singlefile_locally', event.currentTarget.checked)}
            />
            {t("Save SingleFile HTML snapshots locally")}
          </label>
          <Field label={t("SingleFile extension ID")}>
            <input
              value={config.singlefile_extension_id || ''}
              onChange={(event) => saveConfig({ singlefile_extension_id: event.currentTarget.value.trim() })}
              placeholder={defaultSingleFileExtensionId}
            />
          </Field>
          <Field label={t("Tab Manager Plus extension ID")}>
            <input
              value={config.tab_manager_plus_extension_id || ''}
              onChange={(event) => saveConfig({ tab_manager_plus_extension_id: event.currentTarget.value.trim() })}
              placeholder={defaultTabManagerPlusExtensionId}
            />
          </Field>
          <p className="help-text">{t("Leave the Tab Manager Plus extension ID blank to use the default Chrome Web Store ID.")}</p>
          <p className="help-text">{t("$1 Leave the extension ID blank to use the default SingleFile Web Store / Add-ons ID.", singleFileCaptureUnavailableMessage())}</p>
          <StatusBadge status={localCaptureStatus} />
          <div className="section-divider" />
          <SectionHeader title={t("Automatic Archiving")} detail={t("Automatically archive visited pages whose URLs match your patterns.")} />
          <label className="toggle">
            <input type="checkbox" checked={config.enable_auto_archive} onChange={(event) => updateAutoArchive(event.currentTarget.checked)} />
            {t("Enable automatic archiving")}
          </label>
          <Field label={t("Match URL regex")}>
            <input value={config.match_urls} onChange={(event) => saveConfig({ match_urls: event.currentTarget.value })} placeholder="(wikipedia.org)|(archive.org)|(github.com/ArchiveBox/ArchiveBox/$)" />
          </Field>
          <p className="help-text">{t("By default, pages are archived only when you click Save to ArchiveBox. Use")} <code>.*</code> {t("to archive all visited pages, though that is not recommended.")}</p>
          <Field label={t("Exclude URL regex")}>
            <input value={config.exclude_urls} onChange={(event) => saveConfig({ exclude_urls: event.currentTarget.value })} placeholder="(mail.google.com)|(password)|(login)|(logout)|(signup)|(register)" />
          </Field>
          <p className="help-text">{t("Exclude sensitive pages like inboxes, forms, corporate documents, banking sites, login/logout flows, and password pages.")}</p>
          <Field label={t("Test URL")}>
            <input
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
      )}

      {tab === 'profiles' && (
        <section className="panel">
          <SectionHeader title={t("Cookies")} detail={t("Manage cookies and browser-like settings used for logged-in archiving.")} />
          <div className="notice">
            {t("For logged-in archiving, import credentials into one or more archiving profiles. A profile is ArchiveBox's equivalent to a browser profile: cookies plus browser settings for the sites you want to capture.")}
            <pre>{`archivebox config --set COOKIE_FILE=$PWD/cookies.txt
archivebox config --set CHROME_USER_DATA_DIR=$PWD/chrome-user-data`}</pre>
          </div>
          <div className="notice warning">
            {t("Use dedicated archiving accounts where possible so archives do not embed personal browsing data or normal-account cookies.")}
          </div>
          <div className="toolbar">
            <select value={activePersona} onChange={(event) => chooseActivePersona(event.currentTarget.value)}>
              <option value="">{t("Select a profile...")}</option>
              {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            </select>
            <button onClick={createPersona}>{t("New Profile")}</button>
          </div>
          <div className="notice compact">{t("Active profile: $1", activePersonaStats)}</div>
          <StatusBadge status={personaStatus} />
          <div className="persona-list">
            {personas.map((persona) => (
              <article className={persona.id === activePersona ? 'persona active' : 'persona'} key={persona.id}>
                <input value={persona.name} onChange={(event) => savePersona(persona, { name: event.currentTarget.value })} />
                <p>{t("$1 domains · Last used $2", Object.keys(persona.cookies || {}).length, persona.lastUsed ? new Date(persona.lastUsed).toLocaleString() : t("never"))}</p>
                <div className="settings-grid">
                  {[
                    ['userAgent', t("User Agent")],
                    ['geography', t("Geography")],
                    ['timezone', t("Timezone")],
                    ['language', t("Language")],
                    ['operatingSystem', t("Operating System")],
                    ['viewport', t("Viewport Size")],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input value={persona.settings[key as PersonaSettingKey] || ''} onChange={(event) => updatePersonaSetting(persona, key as PersonaSettingKey, event.currentTarget.value)} />
                    </label>
                  ))}
                </div>
                <div className="domain-chips">
                  {Object.keys(persona.cookies || {}).map((domain) => (
                    <button key={domain} onClick={() => removePersonaDomain(persona, domain)}>{domain} ×</button>
                  ))}
                </div>
                <div className="row-actions">
                  <button onClick={() => detectPersonaSettings(persona)}>{t("Detect Settings")}</button>
                  <button onClick={() => copyPersonaCookies(persona)}>{t("Export cookies.txt")}</button>
                  <button onClick={() => deletePersona(persona.id)}>{t("Delete")}</button>
                </div>
              </article>
            ))}
          </div>
          <div className="section-heading cookie-import-heading">
            <div>
              <h2>{t("Import Browser Cookies to Archiving Profile")}</h2>
              <p>{t("Load browser cookies, filter by domain, then copy selected domains into an archiving profile.")}</p>
            </div>
            <div className="cookie-import-actions">
              <button onClick={loadCookies}>{t("Load Browser Cookies")}</button>
              <div className="profile-menu">
                <button
                  disabled={selectedCookieDomains.size === 0 || personas.length === 0}
                  onClick={() => setCookieProfileMenuOpen((open) => !open)}
                >
                  {t("Copy Cookies to Profile ⌄")}
                </button>
                {cookieProfileMenuOpen && (
                  <div className="profile-menu__dropdown" role="menu">
                    {personas.map((persona) => (
                      <button key={persona.id} role="menuitem" onClick={() => importSelectedCookies(persona.id)}>
                        {persona.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <StatusBadge status={cookieStatus} />
            </div>
          </div>
          <div className="table-controls">
            <label className="search-field">
              <Search size={14} aria-hidden="true" />
              <input value={cookieFilter} onChange={(event) => setCookieFilter(event.currentTarget.value)} placeholder={t("Filter cookie domains")} />
            </label>
            <span className="selected-count">{t("$1 selected", selectedCookieDomains.size)}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t("Select all visible cookie domains")}
                    checked={filteredCookies.length > 0 && filteredCookies.every(([domain]) => selectedCookieDomains.has(domain))}
                    onChange={(event) => setAllVisibleCookies(event.currentTarget.checked)}
                  />
                </th>
                <th>{t("Domain")}</th>
                <th>{t("Cookies")}</th>
                <th>{t("Export cookies.txt")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredCookies.map(([domain, cookies]) => (
                <tr key={domain}>
                  <td><input type="checkbox" checked={selectedCookieDomains.has(domain)} onChange={() => setSelectedCookieDomains((current) => {
                    const next = new Set(current);
                    if (next.has(domain)) next.delete(domain);
                    else next.add(domain);
                    return next;
                  })} /></td>
                  <td>{domain}</td>
                  <td>{cookies.length}</td>
                  <td><button onClick={() => copyDomainCookies(domain, cookies)}>{t("Copy cookies.txt")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCookies.length === 0 && <EmptyState title={t("No browser cookies loaded")} detail={t("Click Load Browser Cookies and accept the permission prompt to populate this table.")} />}
        </section>
      )}

      {tab === 'import' && (
        <section className="panel">
          <SectionHeader title={t("Bulk Import URLs")} detail={t("Import URLs from browser history or bookmarks into the saved URL list.")} />
          <div className="toolbar">
            <button onClick={loadHistory}>{t("Import from Browser History")}</button>
            <button onClick={loadBookmarks}>{t("Import from Browser Bookmarks")}</button>
            <button onClick={loadTabManagerPlus}>{t("Import from Tab Manager Plus")}</button>
            <input type="date" value={importStartDate} onChange={(event) => setImportStartDate(event.currentTarget.value)} />
            <input type="date" value={importEndDate} onChange={(event) => setImportEndDate(event.currentTarget.value)} />
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
                  <td><code>{item.url}</code></td>
                  <td>{item.title}</td>
                  <td>{snapshotDate(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {importItems.length === 0 && <EmptyState title={t("No import source loaded")} detail={t("Choose browser history or bookmarks to review URLs before importing.")} />}
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

function SyncStatusIcon({ status }: { status?: Status }) {
  const label = status?.text || t("Not synced");
  const kind = status?.kind || 'idle';
  const icon = kind === 'success'
    ? <CheckCircle2 size={15} aria-hidden="true" />
    : kind === 'error' || kind === 'warning'
      ? <AlertTriangle size={15} aria-hidden="true" />
      : <CircleDashed size={15} aria-hidden="true" />;
  return (
    <span className={`sync-icon sync-icon--${kind}`} title={label} aria-label={label} role="img">
      {icon}
    </span>
  );
}
