import { getConfig, getPersonas, mutateSnapshots } from './storage';
import { t } from './i18n';
import { archiveBoxServerUrlMatches, isArchiveablePageUrl } from './archiveboxUrlExclusions';
import type { ArchiveSubmissionReceipt, SubmissionReceipt, ArchiveDepth, ServerConfiguration, ServerDestination, Snapshot } from './types';

export { archiveBoxServerUrlMatches, isArchiveablePageUrl } from './archiveboxUrlExclusions';

export type ArchiveResultUploadFile = {
  blob: Blob;
  output_path: string;
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

export type ArchiveBoxSnapshotMetadataResponse = {
  id?: string;
};

export const archiveResultUploadChunkSize = 32 * 1024 * 1024;
const archiveResultCreateRetryDelayMs = 500;
const archiveResultCreateMaxAttempts = 24;
const serverTestTimeoutMs = 10_000;

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
    } : {}),
  };
}

function serverBaseUrl(serverUrl: string): string {
  requireHttpServerUrl(serverUrl);
  return new URL(serverUrl).toString().replace(/\/$/, '');
}

function serverUrlError(message: string, serverUrl: string): Error {
  const alternate = new URL(serverUrl);
  alternate.hostname = ['localhost', 'api.localhost'].includes(alternate.hostname) ? 'api.archivebox.localhost' : alternate.hostname.startsWith('api.') ? alternate.hostname.slice(4) : `api.${alternate.hostname}`;
  return new Error(`${message}. ${t("If your ArchiveBox uses the other security mode, try $1", alternate.origin)}`);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = serverTestTimeoutMs): Promise<Response> {
  const serverUrl = new URL(String(input)).origin;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw serverUrlError(t("Server request timed out after $1 seconds", Math.round(timeoutMs / 1000)), serverUrl);
    }
    throw serverUrlError(error instanceof Error ? error.message : String(error), serverUrl);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function isConfiguredArchiveBoxUrl(targetUrl: string): Promise<boolean> {
  return (await getConfig()).servers.some((server) => server.server && archiveBoxServerUrlMatches(server.server, targetUrl));
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

export function archiveBoxSnapshotUrl(serverUrl: string, url: string, legacy = false): string {
  const path = legacy ? url.replace(/^https?:\/\//, '') : url;
  return `${serverBaseUrl(serverUrl)}/archive/${path}`;
}

export async function supportsArchiveBoxApi(serverUrl: string): Promise<boolean> {
  const response = await fetchWithTimeout(`${serverBaseUrl(serverUrl)}/api/`, {
    credentials: 'include',
    mode: 'cors',
  });
  return response.status !== 404 && response.status !== 405;
}

export async function addToArchiveBox(
  server: ServerDestination,
  urls: string[],
  tags: string[] = [],
  depth: ArchiveDepth = 0,
  update = false,
  update_all = false,
  snapshot_ids: string[] = [],
): Promise<ArchiveSubmissionReceipt> {
  return navigator.locks.request<Promise<ArchiveSubmissionReceipt>>(`archivebox-submissions:${server.id}`, async () => {
    const { server: configuredServerUrl, token } = server;
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
    const archiveableSnapshotIds = snapshot_ids.length
      ? archiveableItems.map(({ index }) => snapshot_ids[index] || '')
      : [];
    async function recordSubmission(result: ArchiveSubmissionReceipt): Promise<void> {
      const submitted_at = new Date().toISOString();
      await mutateSnapshots((entries) => entries.map((snapshot) => {
        const index = archiveableSnapshotIds.indexOf(snapshot.id);
        if (index < 0 || snapshot.url !== archiveableUrls[index]) return snapshot;
        return { ...snapshot, remote_copies: { ...snapshot.remote_copies, [server.id]: {
          status: 'accepted', submitted_at, submitted_to: archiveboxServerUrl,
          ...(result.crawl_id ? { crawl_id: result.crawl_id } : {}), persona: server.persona,
        } } };
      }));
    }
    const formattedTags = tags.join(',');
    const { personas } = await getPersonas();
    const persona = personas.find((item) => item.id === server.policy.local_persona_id);

    await ensureServerHostPermission(archiveboxServerUrl);

    const supportsApi = await supportsArchiveBoxApi(archiveboxServerUrl);

    if (!supportsApi && persona && Object.keys(persona.cookies).length) {
      throw new Error(t("This ArchiveBox server does not support persona cookie sync. Select a profile without cookies to submit URLs using the server's own settings, or upgrade the server to use this persona."));
    }

    if (supportsApi && persona) {
      const { syncPersonaCookies } = await import('./cookieSync');
      const synced = await syncPersonaCookies(server, persona.id);
      if (!synced && Object.keys(persona.cookies).length) {
        throw new Error(t("Sync this persona to the configured server before archiving with its cookies."));
      }
    }

    if (supportsApi && token) {
      const response = await fetch(`${archiveboxServerUrl}/api/v1/cli/add`, {
        headers: apiHeaders(token),
        method: 'POST',
        redirect: 'error',
        credentials: 'include',
        mode: 'cors',
        body: JSON.stringify({
          urls: archiveableUrls,
          tag: formattedTags,
          depth,
          persona: server.persona ?? "Default",
          update,
          update_all,
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null) as {
          success?: boolean;
          errors?: unknown[];
          result?: { crawl_id?: string; queued_urls?: string[] };
        } | null;
        if (data?.success !== true || !Array.isArray(data.errors) || data.errors.length
          || typeof data.result?.crawl_id !== 'string' || !data.result.crawl_id.trim()
          || !Array.isArray(data.result.queued_urls)
          || !archiveableUrls.every((url) => data.result!.queued_urls!.includes(url))) {
          throw new Error(t("ArchiveBox did not confirm that the URLs were added. Open the server's Add URLs page to check the form errors."));
        }
        const receipt: SubmissionReceipt = { server_id: server.id, crawl_id: data.result.crawl_id, queued_urls: data.result.queued_urls };
        await recordSubmission(receipt);
        return receipt;
      }
      if (response.status !== 404 && response.status !== 405) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const body = new FormData();
    body.append('url', archiveableUrls.join('\n'));
    body.append('tag', formattedTags);
    body.append('parser', 'auto');
    body.append('depth', String(depth));
    if (supportsApi && server.persona) body.append('persona', server.persona);

    const response = await fetch(`${archiveboxServerUrl}/add/`, {
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      body,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const html = await response.text();
    if (/\/(?:admin|accounts)\/login\/?/.test(new URL(response.url).pathname) || /name=["']password["']/.test(html)) {
      throw new Error(t("Log in to your ArchiveBox server in this browser, or enable PUBLIC_ADD_VIEW on the server, then try again."));
    }
    const resultUrl = new URL(response.url);
    const crawl_id = resultUrl.pathname.match(/\/admin\/core\/crawl\/([0-9a-f-]+)\/change\/?$/i)?.[1] || null;
    if (/class=["'][^"']*errorlist/.test(html)
      || (!supportsApi && !/id=["']stdout["']/.test(html))
      || (crawl_id && resultUrl.origin !== new URL(archiveboxServerUrl).origin)) {
      throw new Error(t("ArchiveBox did not confirm that the URLs were added. Open the server's Add URLs page to check the form errors."));
    }

    const receipt: ArchiveSubmissionReceipt = {
      server_id: server.id,
      crawl_id,
      queued_urls: archiveableUrls,
      legacy: true,
    };
    await recordSubmission(receipt);
    return receipt;
  });
}

export async function getServerPersonas(server: ServerConfiguration): Promise<Array<{ id: string; name: string }>> {
  await ensureServerHostPermission(server.server);
  const items: Array<{ id: string; name: string }> = [];
  while (true) {
    const response = await fetch(`${serverBaseUrl(server.server)}/api/v1/personas/personas?offset=${items.length}`, {
      headers: apiHeaders(server.token), redirect: 'error', credentials: 'include',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const page = await response.json() as { items: Array<{ id: string; name: string }>; total_items: number };
    items.push(...page.items);
    if (items.length >= page.total_items) return items;
    if (!page.items.length) throw new Error('Server returned an incomplete persona list.');
  }
}

export async function syncArchiveBoxSnapshotMetadata(server: ServerConfiguration, snapshot: Snapshot): Promise<ArchiveBoxSnapshotMetadataResponse> {
  const copy = snapshot.remote_copies?.[server.id];
  if (!copy?.crawl_id) throw new Error('No submission receipt for this server.');
  const archiveboxServerUrl = serverBaseUrl(server.server);
  const token = server.token;
  if (!token) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  const response = await fetch(`${archiveboxServerUrl}/api/v1/core/snapshots`, {
    headers: apiHeaders(token),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify({
      url: snapshot.url,
      crawl_id: copy.crawl_id,
      title: snapshot.title || '',
      tags: snapshot.tags || [],
      depth: snapshot.depth ?? 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json().catch(() => ({})) as ArchiveBoxSnapshotMetadataResponse;
}

export async function removeFromArchiveBox(server: ServerConfiguration, snapshot: Snapshot): Promise<void> {
  const copy = snapshot.remote_copies?.[server.id];
  const archiveboxServerUrl = serverBaseUrl(server.server);
  await ensureServerHostPermission(archiveboxServerUrl);
  if (!copy) throw new Error('No submission receipt for this server.');

  let response: Response;
  if (copy.crawl_id) {
    response = await fetch(`${archiveboxServerUrl}/api/v1/crawls/crawl/${encodeURIComponent(copy.crawl_id)}`, {
      headers: apiHeaders(server.token), method: 'DELETE', redirect: 'error', credentials: 'include', mode: 'cors',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json() as { success: boolean; crawl_id: string };
    if (data.success !== true || data.crawl_id !== copy.crawl_id) throw new Error('Server did not confirm removal.');
  } else if (copy.snapshot_id) {
    const snapshotResponse = await fetch(`${archiveboxServerUrl}/api/v1/core/snapshot/${encodeURIComponent(copy.snapshot_id)}?with_archiveresults=false`, {
      headers: apiHeaders(server.token), credentials: 'include', redirect: 'error', mode: 'cors', cache: 'no-store',
    });
    if (!snapshotResponse.ok) throw new Error(`HTTP ${snapshotResponse.status}: ${snapshotResponse.statusText}`);
    const remote = await snapshotResponse.json() as { id?: string; url?: string };
    if (remote.id?.replaceAll('-', '') !== copy.snapshot_id.replaceAll('-', '') || remote.url !== snapshot.url) {
      throw new Error('Server snapshot ownership could not be confirmed.');
    }
    response = await fetch(`${archiveboxServerUrl}/api/v1/core/snapshot/${encodeURIComponent(copy.snapshot_id)}`, {
      headers: apiHeaders(server.token), method: 'DELETE', redirect: 'error', credentials: 'include', mode: 'cors',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json() as { success: boolean; snapshot_id: string };
    if (data.success !== true || data.snapshot_id.replaceAll('-', '') !== copy.snapshot_id.replaceAll('-', '')) throw new Error('Server did not confirm removal.');
  } else {
    throw new Error('No server-owned crawl or snapshot ID for this submission.');
  }
  await mutateSnapshots((entries) => entries.map((item) => {
    const current = item.remote_copies?.[server.id];
    if (item.id !== snapshot.id || !current || current.crawl_id !== copy.crawl_id || current.snapshot_id !== copy.snapshot_id) return item;
    const remote_copies = { ...item.remote_copies };
    delete remote_copies[server.id];
    return { ...item, remote_copies };
  }));
}

export async function uploadSnapshotArchiveResult(server: ServerConfiguration,
  snapshot_id: string,
  plugin: string,
  blob: Blob,
  options: {
    output_path: string;
    mimeType?: string;
    output_json?: Record<string, unknown>;
  },
): Promise<void> {
  await uploadSnapshotArchiveResultFiles(server, snapshot_id, plugin, [{
    blob,
    output_path: options.output_path,
    mimeType: options.mimeType,
  }], {
    output_str: options.output_path,
    output_json: options.output_json,
  });
}

export async function uploadSnapshotArchiveResultFiles(server: ServerConfiguration,
  snapshot_id: string,
  plugin: string,
  files: ArchiveResultUploadFile[],
  options: {
    output_str?: string;
    output_json?: Record<string, unknown>;
    status?: string;
  } = {},
): Promise<ArchiveResultUploadResponse> {
  const archiveboxServerUrl = serverBaseUrl(server.server);
  const token = server.token;
  if (!token) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  function buildBody(): FormData {
    const body = new FormData();
    body.append('snapshot_id', snapshot_id);
    body.append('plugin', plugin);
    if (options.output_str) {
      body.append('output_str', options.output_str);
    }
    if (options.output_json) {
      body.append('output_json', JSON.stringify(options.output_json));
    }
    if (options.status) {
      body.append('status', options.status);
    }
    for (const file of files) {
      const mimeType = file.mimeType || file.blob.type || 'application/octet-stream';
      // Safari 26 can silently send an empty multipart body for disk-backed
      // Files returned by OPFS. Slicing produces a Blob the network process
      // can read without copying the capture into JavaScript memory.
      body.append('files', file.blob.slice(0, file.blob.size, mimeType), file.output_path);
      body.append('output_paths', file.output_path);
      body.append('mime_types', mimeType);
    }
    return body;
  }

  let lastError = '';
  for (let attempt = 1; attempt <= archiveResultCreateMaxAttempts; attempt += 1) {
    const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresults`, {
      headers: apiAuthHeaders(token),
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

export async function addFilesToSnapshotArchiveResult(server: ServerConfiguration,
  archiveResultId: string,
  files: ArchiveResultUploadFile[],
  options: {
    output_str?: string;
    output_json?: Record<string, unknown>;
    status?: string;
  } = {},
): Promise<void> {
  if (files.length === 0) return;
  const archiveboxServerUrl = serverBaseUrl(server.server);
  const token = server.token;
  if (!token) {
    throw new Error(t("API key required"));
  }

  await ensureServerHostPermission(archiveboxServerUrl);

  const body = new FormData();
  if (options.output_str) {
    body.append('output_str', options.output_str);
  }
  if (options.output_json) {
    body.append('output_json', JSON.stringify(options.output_json));
  }
  if (options.status) {
    body.append('status', options.status);
  }
  for (const file of files) {
    const mimeType = file.mimeType || file.blob.type || 'application/octet-stream';
    // See the create path above: OPFS getFile() returns a disk-backed File
    // that affected Safari releases serialize as a zero-length request.
    body.append('files', file.blob.slice(0, file.blob.size, mimeType), file.output_path);
    body.append('output_paths', file.output_path);
    body.append('mime_types', mimeType);
  }

  const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresult/${archiveResultId}`, {
    headers: apiAuthHeaders(token),
    method: 'PATCH',
    credentials: 'include',
    mode: 'cors',
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(`HTTP ${response.status}: ${error?.detail || response.statusText}`);
  }
}

export async function addFileToSnapshotArchiveResultChunked(server: ServerConfiguration,
  archiveResultId: string,
  file: ArchiveResultUploadFile,
  options: {
    output_str?: string;
    output_json?: Record<string, unknown>;
    chunkSize?: number;
    interimStatus?: string;
    finalStatus?: string;
  } = {},
): Promise<void> {
  const archiveboxServerUrl = serverBaseUrl(server.server);
  const token = server.token;
  if (!token) {
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

    body.append('files', chunk, `${file.output_path}.part-${String(chunkIndex).padStart(6, '0')}`);
    body.append('chunk_output_path', file.output_path);
    body.append('chunk_index', String(chunkIndex));
    body.append('chunk_count', String(chunkCount));
    body.append('chunk_offset', String(chunkOffset));
    body.append('chunk_total_size', String(totalSize));
    body.append('mime_type', mimeType);
    body.append('status', finalChunk ? (options.finalStatus || 'succeeded') : (options.interimStatus || 'started'));
    if (options.output_str) {
      body.append('output_str', options.output_str);
    }
    if (options.output_json) {
      body.append('output_json', JSON.stringify({
        ...options.output_json,
        upload_strategy: 'chunked',
        chunk_size: chunkSize,
        chunk_count: chunkCount,
      }));
    }

    const response = await fetch(`${archiveboxServerUrl}/api/v1/core/archiveresult/${archiveResultId}`, {
      headers: apiAuthHeaders(token),
      method: 'PATCH',
      credentials: 'include',
      mode: 'cors',
      body,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(`HTTP ${response.status}: ${error?.detail || response.statusText}`);
    }
  }
}

async function postArchiveBoxApi(server: ServerConfiguration, path: string, body: Record<string, unknown>): Promise<void> {
  const archiveboxServerUrl = serverBaseUrl(server.server);
  const token = server.token;

  if (!token) {
    throw new Error(t("API key required"));
  }
  await ensureServerHostPermission(archiveboxServerUrl);

  const response = await fetch(`${archiveboxServerUrl}${path}`, {
    headers: apiHeaders(token),
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

export async function syncArchiveBoxSnapshotTags(server: ServerConfiguration,
  snapshot_id: string,
  currentTags: string[],
  nextTags: string[],
): Promise<void> {
  const current = new Set(currentTags.map((tag) => tag.trim()).filter(Boolean));
  const next = new Set(nextTags.map((tag) => tag.trim()).filter(Boolean));
  const added = [...next].filter((tag) => !current.has(tag));
  const removed = [...current].filter((tag) => !next.has(tag));

  for (const tag of added) {
    await postArchiveBoxApi(server, '/api/v1/core/tags/add-to-snapshot/', {
      snapshot_id: snapshot_id,
      tag_name: tag,
    });
  }

  for (const tag of removed) {
    await postArchiveBoxApi(server, '/api/v1/core/tags/remove-from-snapshot/', {
      snapshot_id: snapshot_id,
      tag_name: tag,
    });
  }
}

export async function testServerUrl(serverUrl: string): Promise<void> {
  const server = serverBaseUrl(serverUrl);
  await ensureServerHostPermission(server);
  let response = await fetchWithTimeout(`${server}/api/`, { method: 'GET', mode: 'cors' });
  if (response.ok) return;
  if (response.status === 404) {
    response = await fetchWithTimeout(server, { method: 'GET', mode: 'cors' });
    if (response.ok) return;
  }
  throw serverUrlError(`${response.status} ${response.statusText}`, server);
}

export async function testApiKey(serverUrl: string, apiKey: string): Promise<string | number> {
  const archiveboxServerUrl = serverBaseUrl(serverUrl);
  await ensureServerHostPermission(archiveboxServerUrl);
  if (!apiKey) {
    throw new Error(t("API key required"));
  }

  const response = await fetchWithTimeout(`${archiveboxServerUrl}/api/v1/auth/check_api_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    mode: 'cors',
    body: JSON.stringify({ token: apiKey }),
  });

  if (!response.ok) {
    throw serverUrlError(`${response.status} ${response.statusText}`, archiveboxServerUrl);
  }

  const data = (await response.json()) as { user_id?: string | number };
  if (!data.user_id) {
    throw new Error(t("Invalid API key response"));
  }
  return data.user_id;
}

// Retention must not use cached submission state as proof of current connectivity.
export async function snapshotExistsOnServer(snapshot: Snapshot, server: ServerConfiguration): Promise<boolean> {
  try {
    const origin = serverBaseUrl(server.server);
    if (snapshot.remote_copies?.[server.id]?.submitted_to !== origin) return false;
    const id = snapshot.remote_copies?.[server.id]?.snapshot_id;
    if (!id) return false;
    const response = await fetchWithTimeout(
      origin + '/api/v1/core/snapshot/' + encodeURIComponent(id) + '?with_archiveresults=false',
      { headers: apiHeaders(server.token), credentials: 'include', redirect: 'error', cache: 'no-store' },
    );
    if (!response.ok) return false;
    const remote = await response.json() as { id?: string; url?: string };
    return typeof remote.id === 'string'
      && remote.id.replaceAll('-', '') === id.replaceAll('-', '') && remote.url === snapshot.url;
  } catch {
    return false;
  }
}

export async function submitSnapshot(server: ServerDestination, snapshot: Snapshot): Promise<ArchiveSubmissionReceipt> {
  return await navigator.locks.request<Promise<ArchiveSubmissionReceipt>>(`archivebox-delivery:${snapshot.id}`, { mode: 'shared' }, async () =>
    await navigator.locks.request<Promise<ArchiveSubmissionReceipt>>(`archivebox-delivery:${server.id}:${snapshot.id}`, async () => {
      const result = await addToArchiveBox(server, [snapshot.url], snapshot.tags, snapshot.depth ?? 0,
        false, false, [snapshot.id]);
      const accepted: Snapshot = { ...snapshot, remote_copies: { ...snapshot.remote_copies, [server.id]: {
        status: 'accepted', submitted_to: serverBaseUrl(server.server),
        ...(result.crawl_id ? { crawl_id: result.crawl_id } : {}), persona: server.persona,
      } } };
      // Legacy HTML confirmation does not prove completion through the
      // modern metadata/artifact APIs. Keep the durable accepted receipt and
      // leave it accepted until a later explicit verification can complete it.
      if (result.legacy) return result;
      const metadata = await syncArchiveBoxSnapshotMetadata(server, accepted);
      if (!metadata.id) throw new Error('Server did not confirm the saved snapshot.');
      await mutateSnapshots((entries) => entries.map((item) => item.id === snapshot.id && item.remote_copies?.[server.id]?.crawl_id === result.crawl_id ? {
        ...item, remote_copies: { ...item.remote_copies, [server.id]: {
          ...item.remote_copies?.[server.id], status: 'accepted', submitted_to: serverBaseUrl(server.server), snapshot_id: metadata.id,
        } },
      } : item));
      const { uploadSnapshotCaptureArtifactsToArchiveBox } = await import('./archiveboxArtifacts');
      await uploadSnapshotCaptureArtifactsToArchiveBox(server, accepted, metadata.id);
      await mutateSnapshots((entries) => entries.map((item) => item.id === snapshot.id && item.remote_copies?.[server.id]?.crawl_id === result.crawl_id ? {
        ...item, remote_copies: { ...item.remote_copies, [server.id]: { ...item.remote_copies[server.id]!, status: 'complete' } },
      } : item));
      return result;
    }));
}
