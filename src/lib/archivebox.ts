import { getConfig, getArchiveBoxServerUrl } from './storage';
import { t } from './i18n';
import type { ArchiveBoxAddResult, ArchiveDepth } from './types';

function requireHttpServerUrl(serverUrl: string): void {
  try {
    const { protocol } = new URL(serverUrl);
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(t("ArchiveBox server URL must use http:// or https://."));
    }
  } catch {
    throw new Error(t("ArchiveBox server URL must be http:// or https://."));
  }
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...apiAuthHeaders(apiKey),
  };
}

function apiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    ...(apiKey ? {
      Authorization: `Bearer ${apiKey}`,
      'X-ArchiveBox-API-Key': apiKey,
      'x-archivebox-api-key': apiKey,
    } : {}),
  };
}

function serverBaseUrl(serverUrl: string): string {
  requireHttpServerUrl(serverUrl);
  return new URL(serverUrl).origin;
}

async function getConfiguredServerBaseUrl(): Promise<string> {
  const serverUrl = await getArchiveBoxServerUrl();
  if (!serverUrl) {
    throw new Error(t("Server not configured"));
  }
  return serverBaseUrl(serverUrl);
}

function serverHostPermissionPattern(serverUrl: string): string {
  const url = new URL(serverUrl);
  // Host permission patterns are origin-level grants. Keep the configured
  // hostname/IP, but omit the port and path so local and non-local ArchiveBox
  // servers work across browser match-pattern implementations.
  return `${url.protocol}//${url.hostname}/*`;
}

export async function requestServerHostPermission(serverUrl: string): Promise<void> {
  requireHttpServerUrl(serverUrl);
  const origins = [serverHostPermissionPattern(serverUrl)];
  const granted = await browser.permissions.request({ origins }).catch(() => false);
  if (!granted) {
    throw new Error(t("Permission denied for ArchiveBox server URL."));
  }
}

export async function hasServerHostPermission(serverUrl: string): Promise<boolean> {
  requireHttpServerUrl(serverUrl);
  return browser.permissions.contains({ origins: [serverHostPermissionPattern(serverUrl)] }).catch(() => false);
}

async function ensureServerHostPermission(serverUrl: string): Promise<void> {
  requireHttpServerUrl(serverUrl);
  if (await hasServerHostPermission(serverUrl)) return;

  await requestServerHostPermission(serverUrl);
}

export function archiveBoxSnapshotUrl(serverUrl: string, url: string): string {
  return `${serverBaseUrl(serverUrl)}/archive/${url}`;
}

export async function addToArchiveBox(
  urls: string[],
  tags: string[] = [],
  depth: ArchiveDepth = 0,
  update = false,
  update_all = false,
  snapshotIds: string[] = [],
): Promise<ArchiveBoxAddResult | null> {
  const formattedTags = tags.join(',');
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();

  await ensureServerHostPermission(archiveboxServerUrl);

  if (archivebox_api_key) {
    const response = await fetch(`${archiveboxServerUrl}/api/v1/cli/add`, {
      headers: apiHeaders(archivebox_api_key),
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify({
        urls,
        tag: formattedTags,
        formattedTags,
        depth,
        snapshot_ids: snapshotIds,
        update,
        update_all,
      }),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null) as { result?: ArchiveBoxAddResult } | null;
      return data?.result || null;
    }
  }

  const body = new FormData();
  body.append('url', urls.join('\n'));
  body.append('tag', formattedTags);
  body.append('parser', 'auto');
  body.append('depth', String(depth));

  const response = await fetch(`${archiveboxServerUrl}/add/`, {
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return null;
}

export async function removeFromArchiveBox(url: string): Promise<void> {
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();

  await ensureServerHostPermission(archiveboxServerUrl);

  const response = await fetch(`${archiveboxServerUrl}/api/v1/cli/remove`, {
    headers: apiHeaders(archivebox_api_key),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify({
      filter_patterns: [url],
      filter_type: 'exact',
      delete: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json().catch(() => null) as { success?: boolean; errors?: string[] } | null;
  if (data && data.success === false) {
    throw new Error(data.errors?.join(', ') || t("ArchiveBox remove failed: $1"));
  }
}

export async function uploadSnapshotArchiveResult(
  snapshotId: string,
  plugin: 'screenshot' | 'dom' | string,
  blob: Blob,
  options: {
    outputPath: string;
    mimeType?: string;
    outputJson?: Record<string, unknown>;
  },
): Promise<void> {
  await uploadSnapshotArchiveResultFiles(snapshotId, plugin, [{
    blob,
    outputPath: options.outputPath,
    mimeType: options.mimeType,
  }], {
    outputStr: options.outputPath,
    outputJson: options.outputJson,
  });
}

export async function uploadSnapshotArchiveResultFiles(
  snapshotId: string,
  plugin: 'screenshot' | 'dom' | string,
  files: Array<{
    blob: Blob;
    outputPath: string;
    mimeType?: string;
  }>,
  options: {
    outputStr?: string;
    outputJson?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (files.length === 0) return;
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();
  if (!archivebox_api_key) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  const body = new FormData();
  body.append('snapshot_id', snapshotId);
  body.append('plugin', plugin);
  if (options.outputStr) {
    body.append('output_str', options.outputStr);
  }
  if (options.outputJson) {
    body.append('output_json', JSON.stringify(options.outputJson));
  }
  for (const file of files) {
    body.append('files', file.blob, file.outputPath);
    body.append('output_paths', file.outputPath);
    body.append('mime_types', file.mimeType || file.blob.type || 'application/octet-stream');
  }

  const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresults`, {
    headers: apiAuthHeaders(archivebox_api_key),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

async function postArchiveBoxApi(path: string, body: Record<string, unknown>): Promise<void> {
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();

  if (!archivebox_api_key) {
    throw new Error(t("API key required"));
  }
  await ensureServerHostPermission(archiveboxServerUrl);

  const response = await fetch(`${archiveboxServerUrl}${path}`, {
    headers: apiHeaders(archivebox_api_key),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

export async function syncArchiveBoxSnapshotTags(
  snapshotId: string,
  currentTags: string[],
  nextTags: string[],
): Promise<void> {
  const current = new Set(currentTags.map((tag) => tag.trim()).filter(Boolean));
  const next = new Set(nextTags.map((tag) => tag.trim()).filter(Boolean));
  const added = [...next].filter((tag) => !current.has(tag));
  const removed = [...current].filter((tag) => !next.has(tag));

  for (const tag of added) {
    await postArchiveBoxApi('/api/v1/core/tags/add-to-snapshot/', {
      snapshot_id: snapshotId,
      tag_name: tag,
    });
  }

  for (const tag of removed) {
    await postArchiveBoxApi('/api/v1/core/tags/remove-from-snapshot/', {
      snapshot_id: snapshotId,
      tag_name: tag,
    });
  }
}

export async function testServerUrl(serverUrl: string): Promise<void> {
  const archiveboxServerUrl = serverBaseUrl(serverUrl);
  await ensureServerHostPermission(archiveboxServerUrl);

  let response = await fetch(`${archiveboxServerUrl}/api/`, {
    method: 'GET',
    mode: 'cors',
  });

  if (response.ok) return;

  if (response.status === 404) {
    response = await fetch(archiveboxServerUrl, {
      method: 'GET',
      mode: 'cors',
    });
    if (response.ok) return;
  }

  throw new Error(`${response.status} ${response.statusText}`);
}

export async function testApiKey(serverUrl: string, apiKey: string): Promise<string | number> {
  const archiveboxServerUrl = serverBaseUrl(serverUrl);
  await ensureServerHostPermission(archiveboxServerUrl);
  if (!apiKey) {
    throw new Error(t("API key required"));
  }

  const response = await fetch(`${archiveboxServerUrl}/api/v1/auth/check_api_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    mode: 'cors',
    body: JSON.stringify({ token: apiKey }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { user_id?: string | number };
  if (!data.user_id) {
    throw new Error(t("Invalid API key response"));
  }
  return data.user_id;
}
