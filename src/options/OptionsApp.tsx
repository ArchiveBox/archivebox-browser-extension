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
import { TagChip, TagInputChip, TagList } from '@/src/components/Tags';
import { addToArchiveBox } from '@/src/lib/archivebox';
import { loadBookmarkSnapshots, loadHistorySnapshots } from '@/src/lib/browserData';
import { formatCookiesForExport, getCookiesByDomain } from '@/src/lib/cookies';
import { downloadCsv, downloadJson } from '@/src/lib/downloads';
import { readSnapshotScreenshotBlob } from '@/src/lib/screenshotStorage';
import { createSnapshot, filterSnapshots, uniqueTags } from '@/src/lib/snapshots';
import { matchingTagSuggestions } from '@/src/lib/tags';
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

const today = new Date();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const optionTabs: OptionTab[] = [
  { id: 'urls', label: 'Saved URLs', Icon: Database },
  { id: 'config', label: 'Server Configuration', Icon: Settings2 },
  { id: 'profiles', label: 'Authentication Profiles', Icon: UserRoundCog },
  { id: 'import', label: 'Bulk Import URLs', Icon: FileInput },
];

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS')) return 'iOS';
  return 'Unknown';
}

async function detectGeography(): Promise<string> {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json() as { city?: string; country_name?: string };
    return [data.city, data.country_name].filter(Boolean).join(', ') || 'Unknown';
  } catch {
    return 'Unknown';
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

function snapshotScreenshotDownloadName(snapshot: Snapshot): string {
  let host = 'unknown';
  try {
    host = new URL(snapshot.url).hostname;
  } catch {
    host = snapshot.title || snapshot.id;
  }
  return `${snapshot.timestamp.slice(0, 10)}-${safeFileSegment(host)}-${safeFileSegment(snapshot.id)}-screenshot.png`;
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

function extensionUrl(path: string): string {
  return (browser.runtime.getURL as (path: string) => string)(path);
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
    <img
      className="snapshot-screenshot-thumb"
      src={objectUrl}
      alt=""
      loading="lazy"
    />
  );
}

export default function OptionsApp() {
  const [tab, setTab] = useState<Tab>('urls');
  const [snapshots, setSnapshotsState] = useState<Snapshot[]>([]);
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [highlightedSnapshotId, setHighlightedSnapshotId] = useState('');
  const [config, setConfigState] = useState<ConfigState>(defaultConfig);
  const [serverStatus, setServerStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [apiStatus, setApiStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [testStatus, setTestStatus] = useState<Status>({ kind: 'idle', text: '' });
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

  async function refreshAll() {
    const [storedSnapshots, storedConfig, personaState] = await Promise.all([
      getSnapshots(),
      getConfig(),
      ensurePersonas(),
    ]);
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
    if (!persona) return 'No active profile selected';
    const domains = Object.keys(persona.cookies || {});
    const cookieCount = Object.values(persona.cookies || {}).reduce((sum, cookies) => sum + cookies.length, 0);
    return `${domains.length} domains / ${cookieCount} cookies`;
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

  async function exportSelectedScreenshots() {
    if (!selectedSnapshotList.length) return;
    setExportMenuOpen(false);

    let downloaded = 0;
    let missing = 0;
    for (const snapshot of selectedSnapshotList) {
      const blob = await readSnapshotScreenshotBlob(snapshot.screenshot);
      if (!blob) {
        missing += 1;
        continue;
      }
      downloadBlob(blob, snapshotScreenshotDownloadName(snapshot));
      downloaded += 1;
    }

    if (downloaded === 0) {
      setSavedUrlStatus({ kind: 'warning', text: 'No selected snapshots have screenshots' });
      return;
    }

    setSavedUrlStatus({
      kind: missing > 0 ? 'warning' : 'success',
      text: missing > 0
        ? `Downloaded ${downloaded} screenshots; ${missing} missing`
        : `Downloaded ${downloaded} screenshots`,
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
    await updateSnapshotTags(snapshot.id, nextTags, `Added tag "${tag}"`);
    setInlineTagEditor(null);
  }

  async function removeSnapshotTag(snapshot: Snapshot, tag: string) {
    await updateSnapshotTags(
      snapshot.id,
      snapshot.tags.filter((item) => item !== tag),
      `Removed tag "${tag}"`,
    );
  }

  async function saveConfig(patch: Partial<ConfigState>) {
    const next = { ...config, ...patch };
    setConfigState(next);
    await setConfig(patch);
  }

  async function testServer() {
    if (!archiveboxServerUrlIsValid) {
      setServerStatus({ kind: 'warning', text: 'Enter a valid http:// or https:// server URL' });
      return;
    }
    const granted = await browser.permissions.request({
      permissions: ['cookies'],
      origins: [`${archiveboxServerBaseUrl}/*`],
    });
    if (!granted) {
      setServerStatus({ kind: 'error', text: 'Permission denied' });
      return;
    }
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'test_server_url',
      serverUrl: archiveboxServerBaseUrl,
    });
    setServerStatus(response.ok
      ? { kind: 'success', text: 'Server is reachable' }
      : { kind: 'error', text: response.error || 'Server test failed' });
  }

  async function testApiKeyValue() {
    if (!archiveboxServerUrlIsValid) {
      setApiStatus({ kind: 'warning', text: 'Enter a valid http:// or https:// server URL' });
      return;
    }
    const response = await browser.runtime.sendMessage<RuntimeMessage, RuntimeResponse>({
      type: 'test_api_key',
      serverUrl: archiveboxServerBaseUrl,
      apiKey: config.archivebox_api_key,
    });
    setApiStatus(response.ok
      ? { kind: 'success', text: `API key is valid: user_id = ${response.user_id}` }
      : { kind: 'error', text: response.error || 'API key test failed' });
  }

  async function testUrlPatterns() {
    const url = testUrl.trim();
    if (!url) {
      setTestStatus({ kind: 'error', text: 'Please enter a URL to test' });
      return;
    }

    let shouldArchive = false;
    try {
      shouldArchive = new RegExp(config.match_urls || /^$/).test(url);
    } catch (error) {
      setTestStatus({ kind: 'error', text: `Error with match pattern: ${(error as Error).message}` });
      return;
    }

    try {
      if (new RegExp(config.exclude_urls || /^$/).test(url)) {
        setTestStatus({ kind: 'warning', text: 'URL is excluded from auto-archiving' });
        return;
      }
    } catch (error) {
      setTestStatus({ kind: 'error', text: `Error with exclude pattern: ${(error as Error).message}` });
      return;
    }

    if (!shouldArchive) {
      setTestStatus({ kind: 'warning', text: 'URL does not match the auto-archive pattern' });
      return;
    }

    try {
      await addToArchiveBox([url], ['test']);
      setTestStatus({ kind: 'success', text: 'URL was submitted to ArchiveBox' });
      setTestUrl('');
    } catch (error) {
      setTestStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  async function updateAutoArchive(enabled: boolean) {
    if (enabled) {
      const granted = await browser.permissions.request({ permissions: ['tabs'] });
      if (!granted) return;
    }
    await saveConfig({ enable_auto_archive: enabled });
  }

  async function loadCookies() {
    const granted = await browser.permissions.request({
      permissions: ['cookies'],
      origins: ['*://*/*'],
    });
    if (!granted) {
      setCookieStatus({ kind: 'error', text: 'Cookie permission denied' });
      return;
    }
    const nextCookies = await getCookiesByDomain();
    setCookiesByDomain(nextCookies);
    setCookieStatus({ kind: 'success', text: `Loaded cookies for ${Object.keys(nextCookies).length} domains` });
  }

  async function importSelectedCookies(targetPersonaId: string) {
    const targetPersona = personas.find((persona) => persona.id === targetPersonaId);
    if (!targetPersona) {
      setCookieStatus({ kind: 'warning', text: 'Select a profile to copy cookies into' });
      setCookieProfileMenuOpen(false);
      return;
    }
    if (selectedCookieDomains.size === 0) {
      setCookieStatus({ kind: 'warning', text: 'No cookie domains selected' });
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
      text: `Copied ${selectedCount} domain cookies to ${persona?.name || targetPersona.name}`,
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
    const name = prompt('Enter name for new profile:');
    if (!name) return;
    const persona = {
      ...defaultPersona(name),
      settings: await currentPersonaSettings(),
    };
    const nextPersonas = [...personas, persona];
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
    setPersonaStatus({ kind: 'success', text: `Created profile "${name}"` });
  }

  async function savePersona(persona: Persona, patch: Partial<Persona>) {
    const nextPersonas = personas.map((item) => item.id === persona.id ? { ...item, ...patch } : item);
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
  }

  async function deletePersona(id: string) {
    if (!confirm('Delete this profile? This cannot be undone.')) return;
    const nextPersonas = personas.filter((persona) => persona.id !== id);
    setPersonasState(nextPersonas);
    await setPersonas(nextPersonas);
    if (activePersona === id) {
      const nextActive = nextPersonas[0]?.id || '';
      setActivePersonaState(nextActive);
      await setActivePersona(nextActive);
    }
    setPersonaStatus({ kind: 'success', text: 'Profile deleted' });
  }

  async function chooseActivePersona(id: string) {
    setActivePersonaState(id);
    await setActivePersona(id);
  }

  async function detectPersonaSettings(persona: Persona) {
    await savePersona(persona, {
      settings: await currentPersonaSettings(),
    });
    setPersonaStatus({ kind: 'success', text: `Updated browser settings for ${persona.name}` });
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
    const granted = await browser.permissions.request({ permissions: ['history'] });
    if (!granted) {
      setImportStatus({ kind: 'error', text: 'History permission denied' });
      return;
    }
    const existingUrls = new Set(snapshots.map((snapshot) => snapshot.url));
    try {
      const items = await loadHistorySnapshots(importStartDate, importEndDate, existingUrls);
      setImportItems(items);
      setImportStatus({ kind: 'success', text: `Loaded ${items.length} history URLs` });
    } catch (error) {
      setImportStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  async function loadBookmarks() {
    const granted = await browser.permissions.request({ permissions: ['bookmarks'] });
    if (!granted) {
      setImportStatus({ kind: 'error', text: 'Bookmark permission denied' });
      return;
    }
    const existingUrls = new Set(snapshots.map((snapshot) => snapshot.url));
    const items = await loadBookmarkSnapshots(existingUrls);
    setImportItems(items);
    setImportStatus({ kind: 'success', text: `Loaded ${items.length} bookmark URLs` });
  }

  async function importSelectedUrls() {
    const tagsToAdd = importTags.split(',').map((tag) => tag.trim()).filter(Boolean);
    const selected = importItems.filter((item) => item.selected);
    if (!selected.length) {
      setImportStatus({ kind: 'warning', text: 'No items selected' });
      return;
    }
    const selectedIds = new Set(selected.map((item) => item.id));
    const imported = selected.map(({ selected: _selected, isNew: _isNew, ...snapshot }) => ({
      ...snapshot,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tags: tagsToAdd,
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
    setImportStatus({ kind: 'success', text: `Successfully imported ${imported.length} URLs` });
    setTab('urls');
  }

  function setAllVisibleImportItems(selected: boolean) {
    const visibleIds = new Set(filteredImportItems.filter((item) => item.isNew).map((item) => item.id));
    setImportItems((current) => current.map((item) => visibleIds.has(item.id) ? { ...item, selected } : item));
  }

  async function syncSelected() {
    const selected = snapshots.filter((snapshot) => selectedSnapshots.has(snapshot.id));
    if (!selected.length) {
      setSavedUrlStatus({ kind: 'warning', text: 'No snapshots selected' });
      return;
    }
    setSavedUrlStatus({ kind: 'idle', text: `Syncing ${selected.length} snapshots...` });
    for (const snapshot of selected) {
      setSyncStatuses((current) => ({
        ...current,
        [snapshot.id]: { kind: 'warning', text: 'Syncing...' },
      }));
      try {
        await addToArchiveBox([snapshot.url], snapshot.tags);
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'success', text: 'Synced' },
        }));
      } catch (error) {
        setSyncStatuses((current) => ({
          ...current,
          [snapshot.id]: { kind: 'error', text: (error as Error).message },
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setSavedUrlStatus({ kind: 'success', text: `Finished syncing ${selected.length} snapshots` });
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
    setSavedUrlStatus({ kind: 'success', text: `Updated tags on ${selectedSnapshots.size} snapshots` });
  }

  async function copyPersonaCookies(persona: Persona) {
    const domainCount = Object.keys(persona.cookies).length;
    const cookieCount = Object.values(persona.cookies).reduce((sum, cookies) => sum + cookies.length, 0);
    await navigator.clipboard.writeText(formatCookiesForExport(persona.cookies));
    setPersonaStatus({
      kind: 'success',
      text: `${domainCount} domain logins (${cookieCount} cookies) copied for ${persona.name}`,
    });
  }

  async function copyDomainCookies(domain: string, cookies: StoredCookie[]) {
    await navigator.clipboard.writeText(formatCookiesForExport({ [domain]: cookies }));
    setCookieStatus({
      kind: 'success',
      text: `${cookies.length} cookies copied for ${domain}`,
    });
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <img src={extensionUrl('icon/48.png')} alt="" />
          <div>
            <h1>ArchiveBox Collector</h1>
            <p>Collect browser URLs and submit captures to ArchiveBox.</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Options sections">
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
              <span className="saved-url-count">{visibleSnapshots.length} visible / {snapshots.length} saved · {visibleSelectedCount} selected</span>
              <label className="search-field">
                <Search size={14} aria-hidden="true" />
                <input value={filterText} onChange={(event) => updateSavedUrlFilter(event.currentTarget.value)} placeholder="Search by URL, title, ID, timestamp, or tags" />
              </label>
              <button className="icon-button" disabled={!selectedSnapshots.size} onClick={openTagEditor}>
                <Pencil size={14} aria-hidden="true" />
                <span>Tags</span>
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
                  <span>Export</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {exportMenuOpen && selectedSnapshots.size > 0 && (
                  <div className="export-menu__items" role="menu">
                    <button onClick={() => exportSelectedSnapshots('csv')} role="menuitem">CSV</button>
                    <button onClick={() => exportSelectedSnapshots('json')} role="menuitem">JSON</button>
                    <button onClick={exportSelectedScreenshots} role="menuitem">PNG</button>
                  </div>
                )}
              </div>
              <button disabled={!selectedSnapshots.size} onClick={async () => {
                if (!confirm(`Delete ${selectedSnapshots.size} snapshots?`)) return;
                await persistSnapshots(snapshots.filter((snapshot) => !selectedSnapshots.has(snapshot.id)));
                setSelectedSnapshots(new Set());
                setSavedUrlStatus({ kind: 'success', text: 'Deleted selected snapshots' });
              }} className="icon-button">
                <Trash2 size={14} aria-hidden="true" />
                <span>Delete</span>
              </button>
              <button className="icon-button" disabled={!selectedSnapshots.size} onClick={syncSelected}>
                <Upload size={14} aria-hidden="true" />
                <span>Sync</span>
              </button>
              <StatusBadge status={savedUrlStatus} />
            </div>
            <div className="saved-url-table-wrap">
              <table className="saved-url-table">
                <thead>
                  <tr>
                    <th className="saved-url-table__check">
                      <input
                        type="checkbox"
                        aria-label={allVisibleSelected ? 'Deselect all visible URLs' : 'Select all visible URLs'}
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
                        <span>Date Added</span>
                        <b>{savedUrlSortIndicator('date')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'url' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('url')}>
                        <span>URL</span>
                        <b>{savedUrlSortIndicator('url')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'tags' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('tags')}>
                        <span>Tags</span>
                        <b>{savedUrlSortIndicator('tags')}</b>
                      </button>
                    </th>
                    <th aria-sort={savedUrlSortKey === 'sync' ? (savedUrlSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="sort-header" onClick={() => updateSavedUrlSort('sync')}>
                        <span>Status</span>
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
                            <SnapshotScreenshotThumb snapshot={snapshot} />
                            <div className="saved-url-title-row">
                              <div>
                                <strong>{snapshot.title || 'Untitled'}</strong>
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
                            {config.archivebox_server_url && <a href={`${config.archivebox_server_url}/archive/${snapshot.url}`} target="_blank" rel="noopener noreferrer">ArchiveBox</a>}
                            <a href={`https://web.archive.org/web/${snapshot.url}`} target="_blank" rel="noopener noreferrer">Archive.org ↗</a>
                          </div>
                        </td>
                        <td className="saved-url-tags">
                          <TagList>
                            {snapshot.tags.map((tag) => (
                              <TagChip key={tag} label={tag} onRemove={() => removeSnapshotTag(snapshot, tag)} removeTitle={`Remove tag ${tag}`} />
                            ))}
                            {inlineTagEditor?.snapshotId === snapshot.id ? (
                              <TagInputChip
                                value={inlineTagEditor.value}
                                autoFocus
                                placeholder="tag"
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
                              }} title="Add tag" />
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
              {visibleSnapshots.length === 0 && <EmptyState title="No saved URLs match this view" detail="Save a page with the toolbar button or import URLs from browser history/bookmarks." />}
            </div>
          </div>
          <aside className="panel tags-panel">
            <h2>Tags</h2>
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
          <SectionHeader title="Server Configuration" detail="Connect the extension to your self-hosted ArchiveBox server." />
          <Field label="ArchiveBox Server URL">
            <input value={config.archivebox_server_url} onChange={(event) => saveConfig({ archivebox_server_url: event.currentTarget.value })} placeholder="http://localhost:8000 or https://archivebox.example.com" />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin`, '_blank')}>Admin</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/login/`, '_blank')}>Login</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testServer}>Test</button>
            <StatusBadge status={serverStatus} />
          </Field>
          <p className="help-text">
            The base URL of your self-hosted ArchiveBox server. Local HTTP servers such as <code>http://localhost:8000</code> are supported, as are HTTPS deployments.
          </p>
          <Field label="API Key">
            <input value={config.archivebox_api_key} onChange={(event) => saveConfig({ archivebox_api_key: event.currentTarget.value.trim() })} placeholder="... abcexamplekey1234 ..." />
            <button disabled={!archiveboxServerUrlIsValid} onClick={() => window.open(`${archiveboxServerBaseUrl}/admin/api/apitoken/add/`, '_blank')}>Generate</button>
            <button disabled={!archiveboxServerUrlIsValid} onClick={testApiKeyValue}>Test</button>
            <StatusBadge status={apiStatus} />
          </Field>
          <div className="notice">
            API keys are supported by ArchiveBox v0.8.5 and newer. For older servers, leave this blank and stay logged into the ArchiveBox admin UI in this browser. Public unauthenticated adding is possible server-side, but it is a security risk.
          </div>
          <div className="doc-links">
            <a href="https://github.com/ArchiveBox/archivebox-browser-extension#setup" target="_blank" rel="noopener noreferrer">Extension setup guide</a>
            <a href="https://github.com/ArchiveBox/ArchiveBox/wiki/Configuration#public_index--public_snapshots--public_add_view" target="_blank" rel="noopener noreferrer">ArchiveBox server config</a>
            <a href="https://demo.archivebox.io/api/v1/docs" target="_blank" rel="noopener noreferrer">REST API docs</a>
          </div>
          <div className="section-divider" />
          <SectionHeader title="Advanced Auto-Archive" detail="Automatically archive visited pages whose URLs match your patterns." />
          <label className="toggle">
            <input type="checkbox" checked={config.enable_auto_archive} onChange={(event) => updateAutoArchive(event.currentTarget.checked)} />
            Enable automatic archiving
          </label>
          <Field label="Match URL regex">
            <input value={config.match_urls} onChange={(event) => saveConfig({ match_urls: event.currentTarget.value })} placeholder="(wikipedia.org)|(archive.org)|(github.com/ArchiveBox/ArchiveBox/$)" />
          </Field>
          <p className="help-text">By default, pages are archived only when you click Save to ArchiveBox. Use <code>.*</code> to archive all visited pages, though that is not recommended.</p>
          <Field label="Exclude URL regex">
            <input value={config.exclude_urls} onChange={(event) => saveConfig({ exclude_urls: event.currentTarget.value })} placeholder="(mail.google.com)|(password)|(login)|(logout)|(signup)|(register)" />
          </Field>
          <p className="help-text">Exclude sensitive pages like inboxes, forms, corporate documents, banking sites, login/logout flows, and password pages.</p>
          <Field label="Test URL">
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
            <button onClick={testUrlPatterns}>Submit Test</button>
            <StatusBadge status={testStatus} />
          </Field>
        </section>
      )}

      {tab === 'profiles' && (
        <section className="panel">
          <SectionHeader title="Authentication Profiles" detail="Manage cookies and browser-like settings used for logged-in archiving." />
          <div className="notice">
            For logged-in archiving, import credentials into one or more archiving profiles. A profile is ArchiveBox's equivalent to a browser profile: cookies plus browser settings for the sites you want to capture.
            <pre>{`archivebox config --set COOKIE_FILE=$PWD/cookies.txt
archivebox config --set CHROME_USER_DATA_DIR=$PWD/chrome-user-data`}</pre>
          </div>
          <div className="notice warning">
            Use dedicated archiving accounts where possible so archives do not embed personal browsing data or normal-account cookies.
          </div>
          <div className="toolbar">
            <select value={activePersona} onChange={(event) => chooseActivePersona(event.currentTarget.value)}>
              <option value="">Select a profile...</option>
              {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            </select>
            <button onClick={createPersona}>New Profile</button>
          </div>
          <div className="notice compact">Active profile: {activePersonaStats}</div>
          <StatusBadge status={personaStatus} />
          <div className="persona-list">
            {personas.map((persona) => (
              <article className={persona.id === activePersona ? 'persona active' : 'persona'} key={persona.id}>
                <input value={persona.name} onChange={(event) => savePersona(persona, { name: event.currentTarget.value })} />
                <p>{Object.keys(persona.cookies || {}).length} domains · Last used {persona.lastUsed ? new Date(persona.lastUsed).toLocaleString() : 'never'}</p>
                <div className="settings-grid">
                  {[
                    ['userAgent', 'User Agent'],
                    ['geography', 'Geography'],
                    ['timezone', 'Timezone'],
                    ['language', 'Language'],
                    ['operatingSystem', 'Operating System'],
                    ['viewport', 'Viewport Size'],
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
                  <button onClick={() => detectPersonaSettings(persona)}>Detect Settings</button>
                  <button onClick={() => copyPersonaCookies(persona)}>Export cookies.txt</button>
                  <button onClick={() => deletePersona(persona.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
          <div className="section-heading cookie-import-heading">
            <div>
              <h2>Import Browser Cookies to Archiving Profile</h2>
              <p>Load browser cookies, filter by domain, then copy selected domains into an archiving profile.</p>
            </div>
            <div className="cookie-import-actions">
              <button onClick={loadCookies}>Load Browser Cookies</button>
              <div className="profile-menu">
                <button
                  disabled={selectedCookieDomains.size === 0 || personas.length === 0}
                  onClick={() => setCookieProfileMenuOpen((open) => !open)}
                >
                  Copy Cookies to Profile ⌄
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
              <input value={cookieFilter} onChange={(event) => setCookieFilter(event.currentTarget.value)} placeholder="Filter cookie domains" />
            </label>
            <span className="selected-count">{selectedCookieDomains.size} selected</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible cookie domains"
                    checked={filteredCookies.length > 0 && filteredCookies.every(([domain]) => selectedCookieDomains.has(domain))}
                    onChange={(event) => setAllVisibleCookies(event.currentTarget.checked)}
                  />
                </th>
                <th>Domain</th>
                <th>Cookies</th>
                <th>Export cookies.txt</th>
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
                  <td><button onClick={() => copyDomainCookies(domain, cookies)}>Copy cookies.txt</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCookies.length === 0 && <EmptyState title="No browser cookies loaded" detail="Click Load Browser Cookies and accept the permission prompt to populate this table." />}
        </section>
      )}

      {tab === 'import' && (
        <section className="panel">
          <SectionHeader title="Bulk Import URLs" detail="Import URLs from Firefox/Chrome history or bookmarks into the saved URL list." />
          <div className="toolbar">
            <button onClick={loadHistory}>Import from Browser History</button>
            <button onClick={loadBookmarks}>Import from Browser Bookmarks</button>
            <input type="date" value={importStartDate} onChange={(event) => setImportStartDate(event.currentTarget.value)} />
            <input type="date" value={importEndDate} onChange={(event) => setImportEndDate(event.currentTarget.value)} />
            <label className="search-field">
              <Search size={14} aria-hidden="true" />
              <input value={importFilter} onChange={(event) => setImportFilter(event.currentTarget.value)} placeholder="Filter URLs and titles" />
            </label>
            <label className="toggle"><input type="checkbox" checked={showNewOnly} onChange={(event) => setShowNewOnly(event.currentTarget.checked)} /> Show new only</label>
            <input value={importTags} onChange={(event) => setImportTags(event.currentTarget.value)} placeholder="tags,comma,separated" />
            <button disabled={!importItems.some((item) => item.selected)} onClick={importSelectedUrls}>Import Selected ({visibleSelectedImportCount})</button>
            <StatusBadge status={importStatus} />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible import URLs"
                    checked={filteredImportItems.length > 0 && filteredImportItems.filter((item) => item.isNew).every((item) => item.selected)}
                    onChange={(event) => setAllVisibleImportItems(event.currentTarget.checked)}
                  />
                </th>
                <th>URL</th>
                <th>Title</th>
                <th>Timestamp</th>
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
          {importItems.length === 0 && <EmptyState title="No import source loaded" detail="Choose browser history or bookmarks to review URLs before importing." />}
        </section>
      )}

      {editingTags && (
          <dialog className="modal" ref={tagDialogRef} aria-label="Edit tags">
            <h2>Edit Tags</h2>
            <div className="tag-line">
              {modalTags.map((tag) => <button type="button" key={tag} onClick={() => setModalTags(modalTags.filter((item) => item !== tag))}>{tag} ×</button>)}
            </div>
            <div className="toolbar">
              <TagInputChip
                value={newTag}
                placeholder="Add tag"
                suggestions={modalTagSuggestions}
                onCommit={addModalTag}
                onChange={setNewTag}
              />
              <button type="button" onClick={() => {
                addModalTag(newTag);
              }}>Add</button>
            </div>
            <footer className="modal-actions">
              <button type="button" className="modal-button modal-button--cancel" onClick={closeTagEditor}>cancel</button>
              <span>Selected snapshots: {selectedSnapshots.size}</span>
              <button type="button" className="modal-button modal-button--primary" onClick={saveTagChanges}>Save Changes</button>
            </footer>
          </dialog>
      )}
      <footer className="footer-links">
        <a href="https://github.com/ArchiveBox/archivebox-browser-extension" target="_blank" rel="noopener noreferrer">Extension documentation</a>
        <a href="https://github.com/ArchiveBox/ArchiveBox/wiki" target="_blank" rel="noopener noreferrer">ArchiveBox documentation</a>
        <a href="https://chromewebstore.google.com/detail/archivebox-exporter/habonpimjphpdnmcfkaockjnffodikoj?authuser=0&hl=en" target="_blank" rel="noopener noreferrer">Chrome extension details</a>
        <a href="https://github.com/ArchiveBox/archivebox-browser-extension/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
        <a href="https://zulip.archivebox.io" target="_blank" rel="noopener noreferrer">Support forum</a>
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
  const label = status?.text || 'Not synced';
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
