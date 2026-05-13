import { getConfig, getArchiveBoxServerUrl } from './storage';
import type { ArchiveDepth } from './types';

function requireHttpServerUrl(serverUrl: string): void {
  try {
    const { protocol } = new URL(serverUrl);
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw new Error('ArchiveBox server URL must start with http:// or https://');
  }
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-archivebox-api-key': apiKey } : {}),
  };
}

export function archiveBoxSnapshotUrl(serverUrl: string, url: string): string {
  return `${serverUrl.replace(/\/$/, '')}/archive/${url}`;
}

export async function addToArchiveBox(
  urls: string[],
  tags: string[] = [],
  depth: ArchiveDepth = 0,
  update = false,
  update_all = false,
): Promise<void> {
  const formattedTags = tags.join(',');
  const archiveboxServerUrl = await getArchiveBoxServerUrl();
  const { archivebox_api_key } = await getConfig();

  if (!archiveboxServerUrl) {
    throw new Error('Server not configured');
  }
  requireHttpServerUrl(archiveboxServerUrl);

  if (archivebox_api_key) {
    const response = await fetch(`${archiveboxServerUrl}/api/v1/cli/add`, {
      headers: apiHeaders(archivebox_api_key),
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify({ urls, formattedTags, depth, update, update_all }),
    });

    if (response.ok) return;
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
}

export async function removeFromArchiveBox(url: string): Promise<void> {
  const archiveboxServerUrl = await getArchiveBoxServerUrl();
  const { archivebox_api_key } = await getConfig();

  if (!archiveboxServerUrl) {
    throw new Error('Server not configured');
  }
  requireHttpServerUrl(archiveboxServerUrl);

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
    throw new Error(data.errors?.join(', ') || 'ArchiveBox remove failed');
  }
}

export async function testServerUrl(serverUrl: string): Promise<void> {
  requireHttpServerUrl(serverUrl);

  let response = await fetch(`${serverUrl}/api/`, {
    method: 'GET',
    mode: 'cors',
  });

  if (response.ok) return;

  if (response.status === 404) {
    response = await fetch(serverUrl, {
      method: 'GET',
      mode: 'cors',
    });
    if (response.ok) return;
  }

  throw new Error(`${response.status} ${response.statusText}`);
}

export async function testApiKey(serverUrl: string, apiKey: string): Promise<string | number> {
  requireHttpServerUrl(serverUrl);
  if (!apiKey) {
    throw new Error('API key is required');
  }

  const response = await fetch(`${serverUrl}/api/v1/auth/check_api_token`, {
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
    throw new Error('Invalid API key response');
  }
  return data.user_id;
}
