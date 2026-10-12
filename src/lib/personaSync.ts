import { formatCookiesAsNetscape } from './cookies';
import { t } from './i18n';
import { hasServerHostPermission } from './archivebox';
import { capturePersonaStorage } from './personaStorage';
import { currentBrowserIdentity } from './personaSettings';
import { updatePersona } from './storage';
import type { Persona, StoredCookie, ServerConfiguration } from './types';

type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable };

type PersonaSyncResponse = {
  created?: boolean;
  persona?: {
    id?: string;
    name?: string;
  };
  success?: boolean;
};

function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  if (!trimmed) return '';
  return new URL(trimmed).origin;
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? {
      Authorization: `Bearer ${apiKey}`,
    } : {}),
  };
}

function toViewportSize(viewport?: string): string {
  const match = (viewport || '').match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return '';
  return `${match[1]},${match[2]}`;
}

function cookieForAuthJson(cookie: StoredCookie): Record<string, Serializable> {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || '',
    expirationDate: cookie.expirationDate || null,
  };
}

const withoutVersions = (userAgent = '') => userAgent.replace(/(\/|rv:)[\d.]+/g, '$1');

// A profile recorded from this browser exports its live identity on every sync,
// so browser updates and client hints always reach ArchiveBox together with
// the UA. A profile given another UA keeps that identity as configured.
async function syncedIdentity(persona: Persona): Promise<Persona['settings']> {
  const live = await currentBrowserIdentity();
  const { userAgent } = persona.settings;
  if (!userAgent || withoutVersions(userAgent) !== withoutVersions(live.userAgent)) return persona.settings;
  await updatePersona(persona.id, item => ({ ...item, settings: { ...item.settings, ...live } }));
  return { ...persona.settings, ...live };
}

async function buildPersonaSyncPayload(persona: Persona) {
  const storage = await capturePersonaStorage(persona);
  if (storage) await updatePersona(persona.id, item => ({ ...item, storage }));
  persona = { ...persona, settings: await syncedIdentity(persona) };
  const cookies = Object.values(persona.cookies || {}).flat().map(cookieForAuthJson);
  const viewportScale = Number(persona.settings.viewportScale || 1);

  return {
    extension_persona_id: persona.id,
    name: persona.name,
    settings: {
      user_agent: persona.settings.userAgent || '',
      ...(persona.settings.userAgentMetadata !== undefined ? { user_agent_metadata: persona.settings.userAgentMetadata } : {}),
      platform: persona.settings.platform || '',
      viewport_size: toViewportSize(persona.settings.viewport),
      viewport_device_scale_factor: Number.isFinite(viewportScale) ? viewportScale : 1,
      language: persona.settings.language || '',
      timezone: persona.settings.timezone || '',
      geolocation: persona.settings.geolocation ?? null,
      color_scheme: persona.settings.colorScheme || '',
    },
    cookies_txt: formatCookiesAsNetscape(persona.cookies || {}),
    auth_json: {
      TYPE: 'auth',
      SOURCE: 'archivebox-browser-extension',
      extension_persona_id: persona.id,
      captured_at: new Date().toISOString(),
      user_agent: persona.settings.userAgent || '',
      cookies,
      ...(storage || {}),
    },
  };
}

export async function syncPersonaToArchiveBox(server: ServerConfiguration, persona: Persona, expectedServerOrigin?: string): Promise<PersonaSyncResponse> {
  const serverUrl = normalizeServerUrl(server.server);
  if (expectedServerOrigin && serverUrl !== expectedServerOrigin) {
    throw new Error(t("ArchiveBox server changed; sync this profile to the new server manually."));
  }
  if (!serverUrl) throw new Error(t("Server not configured"));
  if (!server.token) throw new Error(t("API key required"));

  if (!(await hasServerHostPermission(serverUrl))) {
    throw new Error(t("Allow access to your ArchiveBox server in extension settings before syncing."));
  }
  const payload = await buildPersonaSyncPayload(persona);

  const response = await fetch(`${serverUrl}/api/v1/personas/sync`, {
    method: 'POST',
    headers: apiHeaders(server.token),
    credentials: 'include',
    mode: 'cors',
    body: JSON.stringify(payload),
  });

  if (response.status === 404) {
    throw new Error(t("ArchiveBox server does not expose the 0.9 persona sync API."));
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `${response.status} ${response.statusText}`);
  }

  return await response.json() as PersonaSyncResponse;
}
