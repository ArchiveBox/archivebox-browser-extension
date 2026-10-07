import { defaultServers } from '@/src/lib/server_registry';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { archiveBoxServerUrlMatches, findSubmittedSnapshot, getServerPersonas, hasServerHostPermission, isArchiveablePageUrl, requestServerHostPermission, syncArchiveBoxSnapshotMetadata, syncArchiveBoxSnapshotTags } from '@/src/lib/archivebox';
import { uploadSnapshotCaptureArtifactsToArchiveBox } from '@/src/lib/archiveboxArtifacts';
import { supportsWaczCapture } from '@/src/lib/browserCapabilities';
import { setUiLanguage, t } from '@/src/lib/i18n';
import { deleteCapture } from '@/src/archive/storage';
import { createSnapshot } from '@/src/lib/snapshots';
import { getConfig, getSnapshots, mutateSnapshots } from '@/src/lib/storage';
import { matchingTagSuggestions } from '@/src/lib/tags';
import type { ArchiveDepth, RuntimeMessage, RuntimeResponse, Snapshot, ServerDestination } from '@/src/lib/types';
import { compactUuid } from '@/src/lib/uuid';
import { submissionAge, submissionMessage } from '@/src/lib/submissionStatus';
import './style.css';

type RemoteArchiveStatus = 'checking' | 'not_archived' | 'archived' | 'sync_failed' | 'unavailable';
type LocalArchiveStatus = 'saved' | 'unsaved' | 'removed';
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
  const registry = await getConfig();
  const archivebox_server_url = defaultServers(registry)[0]?.server || '';
  const extensionOrigin = browser.runtime.getURL('');
  const isOwnExtensionPage = (url = '') => url.startsWith(extensionOrigin);
  const isArchiveablePage = (url = '') => isArchiveablePageUrl(url) && !registry.servers.some((server) => server.server && archiveBoxServerUrlMatches(server.server, url));
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = activeTab?.url && !isOwnExtensionPage(activeTab.url) && isArchiveablePage(activeTab.url)
    ? activeTab
    : (await browser.tabs.query({ currentWindow: true }))
      .filter((candidate) => candidate.id && candidate.url && !isOwnExtensionPage(candidate.url) && isArchiveablePage(candidate.url))
      .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
  if (!tab?.id || !tab.url) throw new Error(t("Open a website tab, then click the ArchiveBox extension to save it."));
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
  let currentSnapshot!: Snapshot;
  let created = false;
  const snapshots = await mutateSnapshots((snapshots) => {
    currentSnapshot = [...snapshots].reverse().find((snapshot) => snapshot.url === activePage.url)!;
    if (!currentSnapshot) {
      currentSnapshot = createSnapshot(activePage.url, [], activePage.title, activePage.favIconUrl || null);
      snapshots.push(currentSnapshot);
      created = true;
    } else {
      currentSnapshot.title ||= activePage.title;
      currentSnapshot.favIconUrl ||= activePage.favIconUrl || null;
    }
    return snapshots;
  });

  return { currentSnapshot, snapshots, created };
}

function unsavedSnapshot(activePage: ActivePage | null): Snapshot | null {
  if (!activePage) return null;
  return createSnapshot(activePage.url, [], activePage.title, activePage.favIconUrl || null);
}

function ArchiveBoxOverlay() {
  const submittedThisSession = useRef(new Set<string>());
  const [now, setNow] = useState(Date.now);
  const [confirmedRemoteId, setConfirmedRemoteId] = useState<string | null>(null);
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
  const [server, setServer] = useState<ServerDestination | null>(null);
  const server_id = server?.id || '';
  const [serverPersonas, setServerPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [personasError, setPersonasError] = useState('');
  const [changingPersona, setChangingPersona] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const selectedPersona = snapshot?.persona_overrides?.[server_id] ?? (snapshot?.remote_copies?.[server_id]?.persona !== undefined ? snapshot.remote_copies[server_id].persona || 'Default' : server?.persona || 'Default');
  useEffect(() => {
    let current = true;
    setServerPersonas([]);
    setPersonasError('');
    if (!server) return;
    setPersonasLoading(true);
    void getServerPersonas(server).then(
      items => { if (current) setServerPersonas(items); },
      error => { if (current) setPersonasError(error instanceof Error ? error.message : String(error)); },
    ).finally(() => { if (current) setPersonasLoading(false); });
    return () => { current = false; };
  }, [server?.id, server?.server, server?.token]);
  const submittedAt = snapshot?.remote_copies?.[server_id]?.submitted_at;
  useEffect(() => {
    const timestamp = submittedAt ? Date.parse(submittedAt) : NaN;
    setNow(Date.now());
    if (!Number.isFinite(timestamp) || Date.now() - timestamp >= 120_000) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time - timestamp >= 120_000) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [submittedAt]);
  function destination(): ServerDestination {
    if (!server) throw new Error(t("Server not configured"));
    return server;
  }
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  async function refresh(checkServer = false) {
    const configured = defaultServers(await getConfig())[0] || null;
    setServer(configured);
    const archivebox_server_url = configured?.server || '';
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot: savedSnapshot, snapshots } = await getCurrentSnapshot(nextActivePage);
    let currentSnapshot = savedSnapshot;
    const cached = currentSnapshot.remote_copies?.[configured?.id || ''];
    let checkError = '';
    // Recent receipts keep submission instant. After two minutes, check server truth:
    // someone may have deleted the URL, or acceptance may not have persisted it.
    // Never reset the submission age just because a check succeeded.
    if (checkServer && configured && cached && !(Date.now() - Date.parse(cached.submitted_at || '') < 120_000)) {
      setConfirmedRemoteId(null);
      setRemoteStatus('checking');
      setStatus(t("Checking ArchiveBox Server..."));
      try {
        const remote = await findSubmittedSnapshot(configured, currentSnapshot.url);
        setConfirmedRemoteId(remote?.id || null);
        const stored = await mutateSnapshots(items => items.map(item => {
          if (item.id !== currentSnapshot.id) return item;
          const latest = item.remote_copies?.[configured.id];
          if (!latest || latest.submitted_at !== cached.submitted_at || latest.snapshot_id !== cached.snapshot_id || latest.crawl_id !== cached.crawl_id) return item;
          const copies = { ...item.remote_copies };
          if (remote) {
            const sameSnapshot = latest?.snapshot_id?.replaceAll('-', '') === remote.id.replaceAll('-', '');
            copies[configured.id] = {
              ...(sameSnapshot ? latest! : { status: 'accepted' as const, submitted_to: configured.server }),
              snapshot_id: remote.id,
              snapshot_crawl_id: remote.crawl_id,
              ...(remote.persona !== undefined ? { persona: remote.persona } : {}),
              submitted_at: sameSnapshot && latest?.submitted_at ? latest.submitted_at : remote.created_at,
            };
          } else delete copies[configured.id];
          return { ...item, remote_copies: copies };
        }));
        currentSnapshot = stored.find(item => item.id === currentSnapshot.id) || currentSnapshot;
      } catch (error) {
        checkError = error instanceof Error ? error.message : String(error);
      }
    }
    setSnapshot({ ...currentSnapshot });
    setDepth(currentSnapshot.depth ?? 0);
    setLocalStatus('saved');
    const receipt = currentSnapshot.remote_copies?.[configured?.id || ''];
    setRemoteStatus(!archivebox_server_url ? 'unavailable' : receipt ? 'archived' : 'not_archived');
    setRemoteDetail(archivebox_server_url ? '' : t("Server not configured"));
    if (!archivebox_server_url) {
      setOk(true);
      setStatus(t("Saved locally"));
    } else if (receipt) {
      setOk(true);
      setStatus(submissionMessage(currentSnapshot.depth ?? 0));
    }
    if (checkError) {
      setOk(false);
      setRemoteStatus('unavailable');
      setRemoteDetail(checkError);
      setStatus(t("Unable to check ArchiveBox Server: $1", checkError));
    } else if (receipt?.delivery_error) {
      setOk(false);
      setRemoteDetail(receipt.delivery_error);
      setStatus(t("URL submitted. Capture upload failed: $1", receipt.delivery_error));
    }
    setAllTags([...new Set([...snapshots].reverse().flatMap((item) => item.tags))]);
    if (supportsWaczCapture && !currentSnapshot.wacz) {
      const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({type:'capture_snapshot_wacz',snapshot_id:currentSnapshot.id,tabId:nextActivePage.tabId});
      if (!response.ok) {setOk(false);setStatus(response.errorMessage || 'Unable to archive page');}
    }
  }

  async function ensureConfiguredServerPermission(requestPermission: boolean): Promise<void> {
    const configuredServerUrl = destination().server;
    if (!configuredServerUrl) throw new Error(t("Server not configured"));
    if (requestPermission) {
      await requestServerHostPermission(configuredServerUrl);
      return;
    }
    if (await hasServerHostPermission(configuredServerUrl)) return;
    if (!requestPermission) {
      throw new Error(t("Click Sync to grant ArchiveBox server permission."));
    }
  }

  async function saveTags(tags: string[]) {
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot } = await getCurrentSnapshot(nextActivePage);
    const previousTags = currentSnapshot.tags;
    currentSnapshot.tags = tags;
    currentSnapshot.depth = depth;
    await mutateSnapshots((items) => items.map((item) => item.id === currentSnapshot.id ? { ...item, tags, depth } : item));
    setSnapshot({ ...currentSnapshot });
    setLocalStatus('saved');
    if (currentSnapshot.remote_copies?.[server_id]?.snapshot_id) {
      try {
        await syncArchiveBoxSnapshotTags(destination(), currentSnapshot.remote_copies![server_id]!.snapshot_id!, previousTags, tags);
        setOk(true);
        setRemoteDetail('');
        setStatus(t("Updated tags on ArchiveBox Server"));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setOk(false);
        setRemoteStatus('sync_failed');
        setRemoteDetail(errorMessage);
        setStatus(t("Saved locally. Failed to archive on server: $1", errorMessage));
      }
    } else {
      await sendToArchiveBox(currentSnapshot.url, tags, depth, currentSnapshot.id, true);
    }
  }

  async function saveDepth(nextDepth: ArchiveDepth) {
    setCrawlMenuOpen(false);
    setDepth(nextDepth);
    const nextActivePage = activePage || await getActivePage();
    setActivePage(nextActivePage);
    const { currentSnapshot } = await getCurrentSnapshot(nextActivePage);
    currentSnapshot.depth = nextDepth;
    await mutateSnapshots((items) => items.map((item) => item.id === currentSnapshot.id ? { ...item, depth: nextDepth } : item));
    setSnapshot({ ...currentSnapshot });
    setLocalStatus('saved');
    await sendToArchiveBox(currentSnapshot.url, currentSnapshot.tags, nextDepth, currentSnapshot.id, true);
  }

  async function sendToArchiveBox(
    url: string,
    tags: string[],
    archiveDepth: ArchiveDepth,
    localSnapshotId?: string,
    requestPermission = false,
    onlyNew?: boolean,
    persona = snapshot?.persona_overrides?.[server_id] ?? (snapshot?.remote_copies?.[server_id]?.persona === null ? 'Default' : snapshot?.remote_copies?.[server_id]?.persona),
    replaceFresh = false,
  ) {
    if (!server) return;
    if (localSnapshotId) submittedThisSession.current.add(`${localSnapshotId}:${destination().id}`);
    setConfirmedRemoteId(null);
    setRemoteStatus('not_archived');
    setRemoteDetail('');
    setStatus(replaceFresh ? t("Finishing previous capture before changing persona...") : t("Sending URL to ArchiveBox Server..."));
    try {
      await ensureConfiguredServerPermission(requestPermission);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Saved locally. Failed to archive on server: $1", errorMessage));
      return;
    }
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'archivebox_add',
      server_id: destination().id,
      tabId: (activePage || await getActivePage()).tabId,
      body: {
        urls: [url],
        tags,
        depth: archiveDepth,
        snapshot_ids: localSnapshotId ? [localSnapshotId] : [],
        titles: snapshot?.title ? [snapshot.title] : [],
        only_new: onlyNew,
        persona,
        replace_fresh: replaceFresh,
      },
    });
    if (response.ok) {
      if (localSnapshotId) submittedThisSession.current.add(`${localSnapshotId}:${destination().id}`);
      if (localSnapshotId) {
        const updated = (await getSnapshots()).find((item) => item.id === localSnapshotId);
        if (updated) setSnapshot(updated);
      }
      setOk(true);
      setRemoteDetail('');
      setRemoteStatus('archived');
      setStatus(submissionMessage(archiveDepth));
      console.info(`ArchiveBox: saved ${url} to ArchiveBox server`);
    } else {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Saved locally. Failed to archive on server: $1", errorMessage));
      console.warn(`ArchiveBox: could not save ${url} to ArchiveBox server: ${errorMessage}`);
    }
  }

  useEffect(() => {
    getConfig()
      .then(({ ui_language }) => {
        setUiLanguage(ui_language);
      })
      .catch(() => undefined)
      .then(() => refresh(true))
      .catch((error: unknown) => {
        setOk(false);
        setStatus(error instanceof Error ? error.message : String(error));
      });
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (snapshot && server && !snapshot.remote_copies?.[server.id] && !submittedThisSession.current.has(`${snapshot.id}:${server.id}`)) {
      sendToArchiveBox(snapshot.url, snapshot.tags, snapshot.depth ?? 0, snapshot.id);
    }
  }, [snapshot?.id, server?.id, Boolean(snapshot?.remote_copies?.[server_id])]);

  useEffect(() => {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' || !changes.entries || !snapshot) return;
      const updated = (changes.entries.newValue as Snapshot[] | undefined)?.find((item) => item.id === snapshot.id);
      if (!updated) return;
      setSnapshot(updated);
      if (!server) return;
      const copy = updated.remote_copies?.[server.id];
      if (copy?.delivery_error) {
        setOk(false);
        setRemoteDetail(copy.delivery_error);
        setStatus(t("URL submitted. Capture upload failed: $1", copy.delivery_error));
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [snapshot?.id, server?.id]);

  useEffect(() => {
    setFaviconFailed(false);
  }, [snapshot?.url, snapshot?.favIconUrl]);

  async function changePersona(persona: string) {
    setPersonaMenuOpen(false);
    if (!snapshot || !server || persona === selectedPersona) return;
    setChangingPersona(true);
    try {
      const entries = await mutateSnapshots(items => items.map(item => item.id === snapshot.id ? {
        ...item, persona_overrides: { ...item.persona_overrides, [server.id]: persona },
      } : item));
      const updated = entries.find(item => item.id === snapshot.id);
      if (!updated) throw new Error(t("Saved snapshot not found."));
      setSnapshot(updated);
      // The background checks actual server ownership before replacing a recent capture.
      await sendToArchiveBox(updated.url, updated.tags, updated.depth ?? depth, updated.id, true,
        updated.remote_copies?.[server.id] ? false : undefined, persona, true);
    } catch (error) {
      setOk(false);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChangingPersona(false);
    }
  }

  async function syncRemoteSnapshot() {
    if (!snapshot) return;
    await sendToArchiveBox(snapshot.url, snapshot.tags, snapshot.depth ?? depth, snapshot.id, true);
  }

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
    // Opening settings should not depend on a background worker waking up.
    if (!id) {
      void browser.runtime.openOptionsPage();
      return;
    }
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
    if (snapshot) await deleteCapture(snapshot.id);
    setIsFadingOut(true);
    window.setTimeout(close, 450);
  }

  async function removeRemoteSnapshot() {
    if (!snapshot || !confirm(t("Remove this URL from the ArchiveBox server?"))) return;
    setStatus(t("ArchiveBox needs permission to connect to your configured server so it can remove this URL."));
    try {
      await ensureConfiguredServerPermission(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to remove from server: $1", errorMessage));
      return;
    }
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'archivebox_remove',
      server_id: destination().id,
      snapshot_id: snapshot.id,
    });
    if (response.ok) {
      setOk(null);
      setRemoteStatus('not_archived');
      setRemoteDetail('');
      setStatus(t("Removed from ArchiveBox Server"));
    } else {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to remove from server: $1", errorMessage));
    }
  }

  async function viewRemoteSnapshot() {
    if (!snapshot) return;
    // Keep submission feedback on successful navigation. A permission request can
    // already be granted; only its actual failure belongs in the status message.
    try {
      await ensureConfiguredServerPermission(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to open archived copy: $1", errorMessage));
      return;
    }
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'open_archivebox_snapshot',
      server_id: destination().id,
      url: snapshot.url,
    });
    if (!response.ok) {
      const errorMessage = response.errorMessage || response.error || t("Unknown error");
      setOk(false);
      setRemoteStatus('sync_failed');
      setRemoteDetail(errorMessage);
      setStatus(t("Failed to open archived copy: $1", errorMessage));
    }
  }

  async function openLocalArchive() {
    if (!snapshot || !activePage) return;
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>(snapshot.wacz
      ? {type:'open_snapshot_wacz',snapshot_id:snapshot.id}
      : {type:'capture_snapshot_wacz',snapshot_id:snapshot.id,tabId:activePage.tabId});
    if (!response.ok) { setOk(false); setStatus(response.errorMessage || 'Unable to archive page'); }
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
                onBlur={(event) => {
                  const nextTag = event.currentTarget.value.trim();
                  if (nextTag) void addTag(nextTag);
                }}
                autoFocus
              />
            )}
          </TagList>

        </div>
      </div>

      <div className="archivebox-overlay__header">
        <div className="archivebox-overlay__capture-actions">
          <button className="archivebox-overlay__capture-button" disabled={!supportsWaczCapture || !snapshot} onClick={()=>void openLocalArchive()}>
            {!supportsWaczCapture ? 'Local archiving requires Chrome or Edge' : snapshot?.wacz?.state === 'complete' ? 'Open archive' : snapshot?.wacz?.state === 'capturing' ? 'Archiving…' : snapshot?.wacz?.state === 'failed' ? 'Capture failed — open details' : 'Archive page'}
          </button>
        </div>
        <div className="archivebox-overlay__crawl">
          <button
            className="archivebox-overlay__crawl-button"
            title={currentDepthLabel}
            aria-label={crawlButtonLabel}
            onClick={() => setCrawlMenuOpen((open) => !open)}
          >
            <span className="archivebox-overlay__crawl-label">{crawlButtonLabel}</span>
            <span className="archivebox-overlay__crawl-label--compact" aria-hidden="true">{t("Crawl")}{depth > 0 ? `: ${depth}` : ''}</span>
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
          <div className="archivebox-overlay__persona">
            <button aria-label={t("Persona")} aria-expanded={personaMenuOpen}
              disabled={!server || !snapshot || personasLoading || changingPersona}
              onClick={() => setPersonaMenuOpen(open => !open)}><span>👤</span><span className="archivebox-overlay__persona-name">{selectedPersona}</span><span>▾</span></button>
            {personaMenuOpen && <div className="archivebox-overlay__persona-menu" role="menu">
              {[...new Set(['Default', selectedPersona, ...serverPersonas.map(item => item.name)])].map(name => (
                <button role="menuitem" key={name} data-persona={name} onClick={() => void changePersona(name)}>{name}</button>
              ))}
            </div>}
          </div>

      </div>

          {personasError && <small className="archivebox-overlay__persona-error">{t("Unable to load personas: $1", personasError)}</small>}
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
        <div className="archivebox-overlay__state-row">
          <span className="archivebox-overlay__state-label">{t("Server")}</span>
          <span
            className={`archivebox-overlay__pill archivebox-overlay__pill--${remoteStatus}`}
            title={remoteDetail || undefined}
          >
            <span className="archivebox-overlay__pill-text">{!server ? t("Server not configured") : remoteStatus === 'archived'
              ? submissionAge(snapshot?.remote_copies?.[server_id]?.submitted_at, now)
              : remoteStatus === 'checking'
                ? t("Checking server...")
              : remoteStatus === 'unavailable'
                ? t("Connection unavailable")
              : remoteStatus === 'sync_failed'
                ? t("Sync failed")
                : t("Not yet archived")}</span>
            {remoteStatus === 'archived'
              && confirmedRemoteId === snapshot?.remote_copies?.[server_id]?.snapshot_id
              && now - Date.parse(snapshot?.remote_copies?.[server_id]?.submitted_at || '') >= 120_000 && <button className="archivebox-overlay__resubmit" onClick={() => snapshot && sendToArchiveBox(snapshot.url, snapshot.tags, depth, snapshot.id, true, false)}>
              {t("Re-submit")}
            </button>}
          </span>
          {remoteStatus !== 'archived' ? (
            <>
              <button className="archivebox-overlay__action" onClick={syncRemoteSnapshot} disabled={remoteStatus === 'checking'} title={t("Sync to ArchiveBox server")}>
                ↑
              </button>
              <span />
            </>
          ) : (
            <>
              <button className="archivebox-overlay__action" onClick={removeRemoteSnapshot} title={t("Remove from ArchiveBox server")}>
                🗑
              </button>
              <button className="archivebox-overlay__action" onClick={viewRemoteSnapshot} title={t("View archived copy on server")}>
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
