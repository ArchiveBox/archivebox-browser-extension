import { getConfig, getArchiveBoxServerUrl } from './storage';
import { t } from './i18n';
import { archiveBoxServerUrlMatches } from './archiveboxUrlExclusions';
import type { ArchiveBoxAddResult, ArchiveDepth, Snapshot } from './types';

export { archiveBoxServerUrlMatches } from './archiveboxUrlExclusions';

export type ArchiveResultUploadFile = {
  blob: Blob;
  outputPath: string;
  mimeType?: string;
};

export type ArchiveResultOutputFile = {
  size?: number;
  mimetype?: string;
  upload?: {
    complete?: boolean;
    chunked?: boolean;
  };
};

export type ArchiveResultUploadResponse = {
  id?: string;
  output_files?: Record<string, ArchiveResultOutputFile>;
};

export const archiveResultUploadChunkSize = 32 * 1024 * 1024;
const archiveResultCreateRetryDelayMs = 500;
const archiveResultCreateMaxAttempts = 24;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

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

export async function isConfiguredArchiveBoxUrl(targetUrl: string): Promise<boolean> {
  return archiveBoxServerUrlMatches(await getArchiveBoxServerUrl(), targetUrl);
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
  if (!granted && await browser.permissions.contains({ origins }).catch(() => false)) return;
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
  titles: string[] = [],
): Promise<ArchiveBoxAddResult | null> {
  const configuredServerUrl = await getArchiveBoxServerUrl();
  if (!configuredServerUrl) {
    throw new Error(t("Server not configured"));
  }
  const archiveboxServerUrl = serverBaseUrl(configuredServerUrl);
  const archiveableItems = urls
    .map((url, index) => ({ url, index }))
    .filter(({ url }) => !archiveBoxServerUrlMatches(configuredServerUrl, url));

  if (!archiveableItems.length) {
    throw new Error(t("ArchiveBox server URLs are ignored."));
  }

  const archiveableUrls = archiveableItems.map(({ url }) => url);
  const archiveableSnapshotIds = snapshotIds.length
    ? archiveableItems.map(({ index }) => snapshotIds[index] || '')
    : [];
  const archiveableTitles = titles.length
    ? archiveableItems.map(({ index }) => titles[index] || '')
    : [];
  const formattedTags = tags.join(',');
  const { archivebox_api_key } = await getConfig();

  await ensureServerHostPermission(archiveboxServerUrl);

  if (archivebox_api_key) {
    const response = await fetch(`${archiveboxServerUrl}/api/v1/cli/add`, {
      headers: apiHeaders(archivebox_api_key),
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify({
        urls: archiveableUrls,
        tag: formattedTags,
        formattedTags,
        depth,
        snapshot_ids: archiveableSnapshotIds,
        titles: archiveableTitles,
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
  body.append('url', archiveableUrls.join('\n'));
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

export async function syncArchiveBoxSnapshotMetadata(snapshot: Snapshot): Promise<void> {
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();
  if (!archivebox_api_key) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  const response = await fetch(`${archiveboxServerUrl}/api/v1/core/snapshots`, {
    headers: apiHeaders(archivebox_api_key),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify({
      url: snapshot.url,
      crawl_id: snapshot.archiveboxCrawlId || null,
      title: snapshot.title || '',
      tags: snapshot.tags || [],
      depth: snapshot.depth ?? 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
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
  plugin: string,
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
  plugin: string,
  files: ArchiveResultUploadFile[],
  options: {
    outputStr?: string;
    outputJson?: Record<string, unknown>;
    status?: string;
  } = {},
): Promise<ArchiveResultUploadResponse> {
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();
  if (!archivebox_api_key) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  function buildBody(): FormData {
    const body = new FormData();
    body.append('snapshot_id', snapshotId);
    body.append('plugin', plugin);
    if (options.outputStr) {
      body.append('output_str', options.outputStr);
    }
    if (options.outputJson) {
      body.append('output_json', JSON.stringify(options.outputJson));
    }
    if (options.status) {
      body.append('status', options.status);
    }
    for (const file of files) {
      body.append('files', file.blob, file.outputPath);
      body.append('output_paths', file.outputPath);
      body.append('mime_types', file.mimeType || file.blob.type || 'application/octet-stream');
    }
    return body;
  }

  let lastError = '';
  for (let attempt = 1; attempt <= archiveResultCreateMaxAttempts; attempt += 1) {
    const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresults`, {
      headers: apiAuthHeaders(archivebox_api_key),
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      body: buildBody(),
    });

    if (response.ok) {
      return await response.json().catch(() => ({})) as ArchiveResultUploadResponse;
    }

    lastError = `HTTP ${response.status}: ${response.statusText}`;
    if (response.status !== 404 || attempt === archiveResultCreateMaxAttempts) {
      throw new Error(lastError);
    }
    await sleep(archiveResultCreateRetryDelayMs);
  }

  throw new Error(lastError || 'ArchiveResult upload failed');
}

export async function addFilesToSnapshotArchiveResult(
  archiveResultId: string,
  files: ArchiveResultUploadFile[],
  options: {
    outputStr?: string;
    outputJson?: Record<string, unknown>;
    status?: string;
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
  if (options.outputStr) {
    body.append('output_str', options.outputStr);
  }
  if (options.outputJson) {
    body.append('output_json', JSON.stringify(options.outputJson));
  }
  if (options.status) {
    body.append('status', options.status);
  }
  for (const file of files) {
    body.append('files', file.blob, file.outputPath);
    body.append('output_paths', file.outputPath);
    body.append('mime_types', file.mimeType || file.blob.type || 'application/octet-stream');
  }

  const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresult/${archiveResultId}`, {
    headers: apiAuthHeaders(archivebox_api_key),
    method: 'PATCH',
    credentials: 'include',
    mode: 'cors',
    body,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

export async function addFileToSnapshotArchiveResultChunked(
  archiveResultId: string,
  file: ArchiveResultUploadFile,
  options: {
    outputStr?: string;
    outputJson?: Record<string, unknown>;
    chunkSize?: number;
    interimStatus?: string;
    finalStatus?: string;
  } = {},
): Promise<void> {
  const archiveboxServerUrl = await getConfiguredServerBaseUrl();
  const { archivebox_api_key } = await getConfig();
  if (!archivebox_api_key) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  const chunkSize = Math.max(1024 * 1024, Math.floor(options.chunkSize || archiveResultUploadChunkSize));
  const totalSize = file.blob.size;
  const chunkCount = Math.max(1, Math.ceil(totalSize / chunkSize));
  const mimeType = file.mimeType || file.blob.type || 'application/octet-stream';

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkOffset = chunkIndex * chunkSize;
    const chunkEnd = Math.min(totalSize, chunkOffset + chunkSize);
    const chunk = file.blob.slice(chunkOffset, chunkEnd, mimeType);
    const body = new FormData();
    const finalChunk = chunkIndex + 1 === chunkCount;

    body.append('files', chunk, `${file.outputPath}.part-${String(chunkIndex).padStart(6, '0')}`);
    body.append('chunk_output_path', file.outputPath);
    body.append('chunk_index', String(chunkIndex));
    body.append('chunk_count', String(chunkCount));
    body.append('chunk_offset', String(chunkOffset));
    body.append('chunk_total_size', String(totalSize));
    body.append('mime_type', mimeType);
    body.append('status', finalChunk ? (options.finalStatus || 'succeeded') : (options.interimStatus || 'started'));
    if (options.outputStr) {
      body.append('output_str', options.outputStr);
    }
    if (options.outputJson) {
      body.append('output_json', JSON.stringify({
        ...options.outputJson,
        upload_strategy: 'chunked',
        chunk_size: chunkSize,
        chunk_count: chunkCount,
      }));
    }

    const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresult/${archiveResultId}`, {
      headers: apiAuthHeaders(archivebox_api_key),
      method: 'PATCH',
      credentials: 'include',
      mode: 'cors',
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
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
