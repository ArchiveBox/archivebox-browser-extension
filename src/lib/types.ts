export type ArchiveDepth = 0 | 1 | 2 | 3 | 4;

export type ServerConfiguration = {
  id: string;
  name: string;
  server: string;
  token: string;
  persona: string | null;
};

// Browser-only policy is stored separately, keyed by the same server ID.
export type ServerPolicy = {
  local_persona_id?: string;
  upload_screenshots_to_server: boolean;
  upload_viewport_screenshots_to_server: boolean;
  upload_mhtml_to_server: boolean;
  upload_singlefile_to_server: boolean;
};
export type ServerDestination = ServerConfiguration & { policy: ServerPolicy };

export type ServerRegistry = {
  schema_version: 1;
  servers: ServerConfiguration[];
  active_server_id: string | null;
  default_server_ids: string[];
};

export type AgentTaskReceipt = {
  session_id: string;
  session_url: string;
  snapshot_id: string;
};

export type RemoteCopy = {
  agent_task?: AgentTaskReceipt;
  crawl_id?: string;
  snapshot_id?: string;
  snapshot_crawl_id?: string;
  // Original crawl that created this snapshot, retained across ONLY_NEW retries.
  owned_crawl_id?: string;
  submitted_at?: string;
  submitted_to: string;
  status: 'accepted' | 'complete';
  delivery_error?: string;
  // Per-server receipts for the exact local capture that was delivered.
  // Absent on older receipts, where file delivery has not been verified.
  artifacts?: Partial<Record<CaptureKind, ArtifactDelivery>>;
  persona?: string | null;
};

export type CaptureKind = 'viewport_screenshot' | 'screenshot' | 'mhtml' | 'singlefile';
export const retentionDurations = [60000, 86400000, 2592000000, 7776000000, 'never'] as const;
export type RetentionDuration = typeof retentionDurations[number];
export type ArtifactDelivery = {
  status: 'uploaded' | 'failed';
  path?: string;
  captured_at?: string;
  archive_result_id?: string;
  uploaded_at?: string;
  error?: string;
};

export type Snapshot = {
  id: string;
  url: string;
  timestamp: string;
  tags: string[];
  title: string;
  favIconUrl?: string | null;
  depth?: ArchiveDepth;
  remote_copies?: Record<string, RemoteCopy>;
  persona_overrides?: Record<string, string>;
  unassigned_remote_copy?: RemoteCopy;
  screenshot?: SnapshotScreenshot;
  viewport_screenshot?: SnapshotScreenshot;
  mhtml?: SnapshotMhtml;
  singlefile?: SnapshotSingleFile;
};

export type SnapshotScreenshot = {
  storage: 'opfs';
  path: string;
  parts?: SnapshotScreenshotPart[];
  mimeType: 'image/png';
  capturedAt: string;
  width: number;
  height: number;
};

export type SnapshotScreenshotPart = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SnapshotMhtml = {
  storage: 'opfs';
  path: string;
  mimeType: 'multipart/related';
  capturedAt: string;
  size: number;
};

export type SnapshotSingleFile = {
  storage: 'opfs';
  path: string;
  mimeType: 'text/html';
  capturedAt: string;
  size: number;
  filename?: string;
};

export type PersonaSettings = {
  userAgent?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  viewportScale?: string;
  colorScheme?: string;
  operatingSystem?: string;
  geography?: string;
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  } | null;
};

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
};

export type PersonaOriginStorage = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
  indexedDB: Array<{
    name: string;
    version: number;
    stores: Array<{ name: string; keyPath: string | string[] | null; autoIncrement: boolean;
      indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }> }>;
    data: string; // Dexie structured-clone export, with exact native schema above.
  }>;
};

export type PersonaTabStorage = {
  url: string;
  sessionStorage: Array<{ name: string; value: string }>;
};

export type Persona = {
  id: string;
  name: string;
  created: string;
  last_used: string | null;
  remote_personas?: Record<string, { id: string; url: string }>;
  cookies: Record<string, StoredCookie[]>;
  settings: PersonaSettings;
  storage?: { origins: PersonaOriginStorage[]; tabs: PersonaTabStorage[] };
};

export type ConfigState = ServerRegistry & {
  server_policies: Record<string, ServerPolicy>;
  ui_language: 'auto' | 'en' | 'es' | 'zh_CN';
  match_urls: string;
  exclude_urls: string;
  local_retention_ms: RetentionDuration;
  // Missing entries inherit the snapshot TTL. Explicit values cannot exceed it.
  capture_retention_ms: Partial<Record<CaptureKind, RetentionDuration>>;
  enable_auto_archive: boolean;
  save_snapshots_locally: boolean;
  save_screenshots_locally: boolean;
  save_viewport_screenshots_locally: boolean;
  save_mhtml_locally: boolean;
  save_singlefile_locally: boolean;
  singlefile_extension_id: string;
  tab_manager_plus_extension_id: string;
};

export type ArchiveboxAddMessage = {
  type: 'archivebox_add';
  server_id: string;
  tabId?: number;
  body: {
    urls: string[];
    tags: string[];
    depth?: ArchiveDepth;
    snapshot_ids?: string[];
    titles?: string[];
    only_new?: boolean;
    persona?: string;
    replace_fresh?: boolean;
  };
};

// Capture-retention updates patch one type; null restores inheritance.
export type ConfigPatch = Omit<Partial<ConfigState>, 'capture_retention_ms'> & {
  capture_retention_ms?: Partial<Record<CaptureKind, RetentionDuration | null>>;
};

export type ArchiveboxRemoveMessage = {
  type: 'archivebox_remove';
  server_id: string;
  snapshot_id: string;
};

export type TestServerMessage = {
  type: 'test_server_url';
  server: string;
};

export type TestApiKeyMessage = {
  type: 'test_api_key';
  server: string;
  token: string;
};

export type OpenOptionsMessage = {
  type: 'open_options';
  id?: string;
  view?: 'highlight' | 'screenshot' | 'mhtml' | 'singlefile';
};

export type OpenArchiveBoxSnapshotMessage = {
  type: 'open_archivebox_snapshot';
  server_id: string;
  url: string;
};

export type CaptureSnapshotScreenshotMessage = {
  type: 'capture_snapshot_screenshot';
  snapshot_id: string;
  tabId: number;
  windowId: number;
  fullPage?: boolean;
};

export type CancelSnapshotScreenshotMessage = {
  type: 'cancel_snapshot_screenshot';
  snapshot_id: string;
};

export type ScreenshotCaptureProgressMessage = {
  type: 'screenshot_capture_progress';
  snapshot_id: string;
  captured: number;
  total: number;
  phase: 'visible' | 'scrolling' | 'done' | 'canceled';
};

export type MeasureScreenshotPageMessage = {
  type: 'measure_screenshot_page';
  tabId: number;
};

export type CaptureSnapshotMhtmlMessage = {
  type: 'capture_snapshot_mhtml';
  snapshot_id: string;
  tabId: number;
  windowId: number;
};

export type CaptureSnapshotSingleFileMessage = {
  type: 'capture_snapshot_singlefile';
  snapshot_id: string;
  tabId: number;
  windowId: number;
};

export type ScreenshotGetMetricsMessage = {
  type: 'screenshot_get_metrics';
};

export type ScreenshotScrollMessage = {
  type: 'screenshot_scroll';
  x: number;
  y: number;
};

export type ScreenshotRestoreScrollMessage = {
  type: 'screenshot_restore_scroll';
  x: number;
  y: number;
};

export type RuntimeMessage =
  | { type: 'submit_agent_task'; server_id: string; snapshot_id: string; task: string }
  | { type: 'set_config'; patch: ConfigPatch }
  | ArchiveboxAddMessage
  | ArchiveboxRemoveMessage
  | TestServerMessage
  | TestApiKeyMessage
  | OpenOptionsMessage
  | OpenArchiveBoxSnapshotMessage
  | CaptureSnapshotScreenshotMessage
  | CancelSnapshotScreenshotMessage
  | ScreenshotCaptureProgressMessage
  | MeasureScreenshotPageMessage
  | CaptureSnapshotMhtmlMessage
  | CaptureSnapshotSingleFileMessage
  | ScreenshotGetMetricsMessage
  | ScreenshotScrollMessage
  | ScreenshotRestoreScrollMessage;

export type RuntimeResponse = {
  ok: boolean;
  receipt?: ArchiveSubmissionReceipt | null;
  agentTask?: AgentTaskReceipt;
  error?: string;
  errorMessage?: string;
  user_id?: string | number;
  screenshotNeedsScroll?: boolean;
  screenshotCanceled?: boolean;
  screenshot?: SnapshotScreenshot;
  mhtml?: SnapshotMhtml;
  singlefile?: SnapshotSingleFile;
};

export type SubmissionReceipt = {
  server_id: string;
  crawl_id: string;
  queued_urls: string[];
  legacy?: false;
};

// Published legacy /add/ deployments confirm success in HTML and may not
// expose a server-owned crawl ID. Keep that state explicit instead of
// fabricating an ID or treating it as a modern receipt.
export type LegacySubmissionReceipt = {
  server_id: string;
  crawl_id: string | null;
  queued_urls: string[];
  legacy: true;
};

export type ArchiveSubmissionReceipt = SubmissionReceipt | LegacySubmissionReceipt;
