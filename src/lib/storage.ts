import type { ConfigState, Persona, Snapshot } from './types';

const defaultConfig: ConfigState = {
  archivebox_server_url: '',
  archivebox_api_key: '',
  match_urls: '',
  exclude_urls: '',
  enable_auto_archive: false,
  save_screenshots_locally: false,
  save_mhtml_locally: false,
};

export async function getConfig(): Promise<ConfigState> {
  const local = await browser.storage.local.get([
    'archivebox_server_url',
    'archivebox_api_key',
    'match_urls',
    'exclude_urls',
    'enable_auto_archive',
    'save_screenshots_locally',
    'save_mhtml_locally',
  ]);
  const sync = await browser.storage.sync.get(['config_archiveBoxBaseUrl']);

  return {
    archivebox_server_url: String(
      local.archivebox_server_url || sync.config_archiveBoxBaseUrl || '',
    ),
    archivebox_api_key: String(local.archivebox_api_key || ''),
    match_urls: typeof local.match_urls === 'string' ? local.match_urls : '',
    exclude_urls: typeof local.exclude_urls === 'string' ? local.exclude_urls : '',
    enable_auto_archive: Boolean(local.enable_auto_archive),
    save_screenshots_locally: Boolean(local.save_screenshots_locally),
    save_mhtml_locally: Boolean(local.save_mhtml_locally),
  };
}

export async function setConfig(config: Partial<ConfigState>): Promise<void> {
  const nextConfig: Partial<ConfigState> = { ...config };
  if (typeof nextConfig.archivebox_server_url === 'string') {
    nextConfig.archivebox_server_url = nextConfig.archivebox_server_url.replace(/\/$/, '');
  }
  await browser.storage.local.set(nextConfig);
}

export async function getArchiveBoxServerUrl(): Promise<string> {
  return (await getConfig()).archivebox_server_url;
}

export async function getSnapshots(): Promise<Snapshot[]> {
  const { entries = [] } = await browser.storage.local.get('entries');
  return Array.isArray(entries) ? (entries as Snapshot[]) : [];
}

export async function setSnapshots(entries: Snapshot[]): Promise<void> {
  await browser.storage.local.set({ entries });
}

export async function getPersonas(): Promise<{
  personas: Persona[];
  activePersona: string;
}> {
  const { personas = [], activePersona = '' } = await browser.storage.local.get([
    'personas',
    'activePersona',
  ]);
  return {
    personas: Array.isArray(personas) ? (personas as Persona[]) : [],
    activePersona: String(activePersona || ''),
  };
}

export async function setPersonas(personas: Persona[]): Promise<void> {
  await browser.storage.local.set({ personas });
}

export async function setActivePersona(activePersona: string): Promise<void> {
  await browser.storage.local.set({ activePersona });
}

export function defaultPersona(name: string): Persona {
  return {
    id: crypto.randomUUID(),
    name,
    created: new Date().toISOString(),
    lastUsed: null,
    cookies: {},
    settings: {},
  };
}

export async function ensurePersonas(): Promise<{
  personas: Persona[];
  activePersona: string;
}> {
  let { personas, activePersona } = await getPersonas();
  if (personas.length === 0) {
    personas = ['Private', 'Work', 'Anonymous'].map(defaultPersona);
    await setPersonas(personas);
  }
  if (!activePersona && personas[0]) {
    activePersona = personas[0].id;
    await setActivePersona(activePersona);
  }
  return { personas, activePersona };
}

export { defaultConfig };
