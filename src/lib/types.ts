export type ArchiveDepth = 0 | 1 | 2 | 3 | 4;

export type Snapshot = {
  id: string;
  url: string;
  timestamp: string;
  tags: string[];
  title: string;
  favIconUrl?: string | null;
  depth?: ArchiveDepth;
  screenshot?: SnapshotScreenshot;
};

export type SnapshotScreenshot = {
  storage: 'opfs';
  path: string;
  mimeType: 'image/png';
  capturedAt: string;
  width: number;
  height: number;
};

export type PersonaSettings = {
  userAgent?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  operatingSystem?: string;
  geography?: string;
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

export type Persona = {
  id: string;
  name: string;
  created: string;
  lastUsed: string | null;
  cookies: Record<string, StoredCookie[]>;
  settings: PersonaSettings;
};

export type ConfigState = {
  archivebox_server_url: string;
  archivebox_api_key: string;
  match_urls: string;
  exclude_urls: string;
  enable_auto_archive: boolean;
};

export type ArchiveboxAddMessage = {
  type: 'archivebox_add';
  body: {
    urls: string[];
    tags: string[];
    depth?: ArchiveDepth;
  };
};

export type ArchiveboxRemoveMessage = {
  type: 'archivebox_remove';
  url: string;
};

export type TestServerMessage = {
  type: 'test_server_url';
  serverUrl: string;
};

export type TestApiKeyMessage = {
  type: 'test_api_key';
  serverUrl: string;
  apiKey: string;
};

export type OpenOptionsMessage = {
  type: 'open_options';
  id?: string;
};

export type OpenArchiveBoxSnapshotMessage = {
  type: 'open_archivebox_snapshot';
  url: string;
};

export type ShowOverlayMessage = {
  type: 'show_archivebox_overlay';
};

export type HideOverlayMessage = {
  type: 'hide_archivebox_overlay';
};

export type CaptureSnapshotScreenshotMessage = {
  type: 'capture_snapshot_screenshot';
  snapshotId: string;
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
  | ArchiveboxAddMessage
  | ArchiveboxRemoveMessage
  | TestServerMessage
  | TestApiKeyMessage
  | OpenOptionsMessage
  | OpenArchiveBoxSnapshotMessage
  | ShowOverlayMessage
  | HideOverlayMessage
  | CaptureSnapshotScreenshotMessage
  | ScreenshotGetMetricsMessage
  | ScreenshotScrollMessage
  | ScreenshotRestoreScrollMessage;

export type RuntimeResponse = {
  ok: boolean;
  error?: string;
  errorMessage?: string;
  user_id?: string | number;
  screenshot?: SnapshotScreenshot;
};
