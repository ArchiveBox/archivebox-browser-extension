import { ensurePersonas } from './storage';
import { cookieSiteDomain } from './cookieSites';
import type { ServerDestination, Snapshot } from './types';

export async function resolvePersona(server: ServerDestination, snapshot: Snapshot, tabId?: number): Promise<ServerDestination> {
  const { personas, anonymous_persona } = await ensurePersonas();
  const anonymous = personas.find(item => item.id === (server.policy.anonymous_persona === undefined
    ? anonymous_persona : server.policy.anonymous_local_persona_id))?.name || server.policy.anonymous_persona || 'Default';
  let name = snapshot.persona_overrides?.[server.id] ?? snapshot.remote_copies?.[server.id]?.persona;
  if (name === undefined) {
    name = personas.find(item => item.id === server.policy.local_persona_id)?.name || server.persona || 'Default';
    try {
      const tabs = tabId === undefined ? (await browser.tabs.query({})).filter(tab => tab.url === snapshot.url) : [await browser.tabs.get(tabId)];
      const tab = tabs.length === 1 ? tabs[0] : undefined;
      const url = new URL(snapshot.url);
      const domain = cookieSiteDomain(url.hostname);
      if (tab?.id && !tab.discarded && tab.url === snapshot.url
        && await browser.permissions.contains({ permissions: ['cookies', 'scripting'], origins: [`${url.protocol}//*.${domain}/*`] })) {
        const store = (await browser.cookies.getAllCookieStores()).find(store => store.tabIds.includes(tab.id!));
        if (store) {
          const cookies = await browser.cookies.getAll({ domain, storeId: store.id, partitionKey: {} });
          const [state] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: async () => ({
            url: location.href, hasStorage: !!(localStorage.length || sessionStorage.length || (await indexedDB.databases()).length),
          }) });
          if (!cookies.length && state?.result?.url === snapshot.url && state.result.hasStorage === false) name = anonymous;
        }
      }
    } catch { /* Unknown page state retains the logged-in default. */ }
  }
  const local = personas.find(item => item.name === (name || 'Default'));
  return { ...server, persona: name || 'Default', policy: { ...server.policy, local_persona_id: local?.id,
    ...(name === anonymous ? { upload_screenshots_to_server: false, upload_viewport_screenshots_to_server: false,
      upload_mhtml_to_server: false, upload_singlefile_to_server: false } : {}),
  } };
}
