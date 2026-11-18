import { siteCookieSource, siteHostname, siteRulePatch } from './siteRules';
import { isArchiveablePageUrl, isConfiguredArchiveBoxUrl } from './archivebox';
import { normalizeCookie } from './cookies';
import { t } from './i18n';
import { activeServer, defaultServers } from './server_registry';
import { getConfig, getPersonas, setConfig, updatePersona } from './storage';

type SaveTab = (tab: Browser.tabs.Tab, tags?: string[]) => Promise<boolean>;
const prefix = 'archivebox-action-';

async function openOptions(section = '', params: Record<string, string> = {}) {
  const url = new URL(browser.runtime.getURL('/options.html'));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = section;
  await browser.tabs.create({ url: url.href });
}

async function feedback(text: string, failed = false) {
  await browser.action.setBadgeText({ text: failed ? '!' : '✓' }).catch(() => undefined);
  await browser.action.setTitle({ title: `ArchiveBox: ${text}` }).catch(() => undefined);
}

let menuUpdate = Promise.resolve();
export function rebuildActionMenus(): Promise<void> {
  menuUpdate = menuUpdate.catch(() => undefined).then(async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: 'save_to_archivebox_ctxmenu', title: t('Save to ArchiveBox'), contexts: ['page'] });
    const add = (id: string, title: string, parentId?: string, type?: 'separator') => browser.contextMenus.create({
      id: prefix + id, ...(type ? { type } : { title: t(title) }), contexts: ['action'], ...(parentId ? { parentId: prefix + parentId } : {}),
    });
    // Chromium renders at most SIX action-menu roots. Keep the common four
    // operations directly accessible; group every other item in native flyouts.
    add('save', '💾 Save current tab only');
    add('save-all', '📚 Save all tabs in this window');
    add('close-all', '🧹 Save + close all tabs in this window');
    add('search', '🔎 Search for current URL in archive');
    add('site', '🌐 This site');
    add('allow', '✅ Always archive URLs on this domain', 'site');
    add('deny', '⛔ Never archive URLs on this domain', 'site');
    add('site-separator', '', 'site', 'separator');
    add('cookies', '🍪 Save site login Cookies to your Persona', 'site');
    add('history', '🕘 Save last 90d of visits on this site', 'site');
    add('extension', '❓ Help');
    add('website', '🌐 Website', 'extension');
    add('github', '💻 Github', 'extension');
    add('bug', '🐛 Report a bug', 'extension');
    add('mobile', '📱 Setup on Mobile', 'extension');
    add('extension-separator', '', 'extension', 'separator');
    add('admin', '🏛 Server Admin UI', 'extension');
    add('settings', '⚙ Extension Settings', 'extension');
    add('collection', '🗃 Collection', 'extension');
  });
  return menuUpdate;
}

async function saveWindow(tab: Browser.tabs.Tab, save: SaveTab, close: boolean) {
  if (tab.windowId === undefined || tab.windowId < 0 || tab.incognito) throw new Error(t('Use a normal browser window to save tabs.'));
  if (!(await browser.permissions.request({ permissions: ['tabs'] }))) throw new Error(t('Tab permission denied; no tabs were closed.'));
  await navigator.locks.request(`archivebox-menu-window-${tab.windowId}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error(t('This window is already being saved.'));
    const tabs = await browser.tabs.query({ windowId: tab.windowId });
    let saved = 0, closed = 0, kept = 0;
    for (const candidate of tabs) {
      if (!candidate.id || !candidate.url || candidate.incognito || !isArchiveablePageUrl(candidate.url)
        || await isConfiguredArchiveBoxUrl(candidate.url)) { kept++; continue; }
      if (!(await save(candidate, [close ? 'close-all-tabs' : 'save-all-tabs']))) { kept++; continue; }
      saved++;
      if (close) {
        const current = await browser.tabs.get(candidate.id).catch(() => undefined);
        // Never close a tab that moved windows or navigated during capture.
        if (current?.windowId === tab.windowId && current.url === candidate.url && !current.incognito) {
          await browser.tabs.remove(candidate.id);
          closed++;
        } else kept++;
      }
    }
    await feedback(t('$1 saved; $2 closed; $3 kept.', saved, closed, kept));
  });
}

export async function copySiteCookiesToPersona(tab: Browser.tabs.Tab, personaId: string) {
  const fallback = (message: string): never => { throw new Error(message); };
  const persona = (await getPersonas()).personas.find(item => item.id === personaId);
  if (!persona || !tab.id || tab.incognito || !tab.url?.startsWith('https://') || !siteHostname(tab.url)) {
    return fallback(t('Choose a normal HTTPS site and an existing Persona. No cookies were copied.'));
  }
  const url = new URL(tab.url);
  if (!(await browser.permissions.contains({ permissions: ['cookies'], origins: [`${url.protocol}//${url.hostname}/*`] }))) {
    return fallback(t('Use Cookies & profiles to review site permissions. No cookies were copied.'));
  }
  const stores = await browser.cookies.getAllCookieStores();
  const matches = stores.filter(store => store.tabIds.includes(tab.id!));
  const store = matches.length === 1 ? matches[0] : undefined;
  if (!store) return fallback(t('Could not verify this tab’s cookie store. No cookies were copied.'));
  const cookies = await browser.cookies.getAll({ url: url.href, storeId: store.id });
  // Reading may outlive a navigation. Do not attribute the wrong site's jar.
  const current = await browser.tabs.get(tab.id);
  if (current.url !== tab.url || current.windowId !== tab.windowId || current.incognito) {
    return fallback(t('The tab changed. No cookies were copied.'));
  }
  const updated = await updatePersona(personaId, item => {
    const next = { ...item.cookies };
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, '');
      const previous = next[domain] || [];
      const normalized = normalizeCookie(cookie);
      const identity = (value: typeof normalized) => value.name === normalized.name && value.domain === normalized.domain && value.path === normalized.path;
      next[domain] = [...previous.filter(value => !identity(value)), normalized];
    }
    return { ...item, cookies: next, last_used: new Date().toISOString() };
  });
  if (!updated) return fallback(t('The Persona no longer exists. No cookies were copied.'));
  // Deliberately do not call syncPersonaManually: it exports the whole Persona
  // and enables ongoing sync, neither of which this local copy action grants.
  return { count: cookies.length, personaName: persona.name };
}

export async function handleActionMenu(id: string | number, tab: Browser.tabs.Tab | undefined, save: SaveTab): Promise<void> {
  const item = String(id);
  try {
    if (item === 'save_to_archivebox_ctxmenu' || item === prefix + 'save') {
      if (!tab || !(await save(tab))) throw new Error(t('The tab was not saved. It remains open.'));
      return feedback(t('Current tab saved.'));
    }
    const links: Record<string, string> = {
      website: 'https://extension.archivebox.io', github: 'https://github.com/ArchiveBox/archivebox-browser-extension',
      bug: 'https://github.com/ArchiveBox/archivebox-browser-extension/issues', mobile: 'https://app.archivebox.io',
    };
    const action = item.slice(prefix.length);
    if (links[action]) { await browser.tabs.create({ url: links[action] }); return; }
    if (action === 'settings') return openOptions('Configuration');
    if (action === 'collection') return openOptions();
    if (action === 'admin') {
      const config = await getConfig();
      const server = activeServer(config) || defaultServers(config)[0];
      if (!server?.server) return openOptions('Configuration', { menu_status: t('Configure an ArchiveBox server first.') });
      await browser.tabs.create({ url: new URL('admin/', server.server.replace(/\/?$/, '/')).href });
      return;
    }
    if (action === 'save-all' || action === 'close-all') {
      if (!tab) throw new Error(t('Choose a browser window first.'));
      return saveWindow(tab, save, action === 'close-all');
    }
    if (!tab?.url || tab.incognito || !siteHostname(tab.url)) throw new Error(t('Choose a normal HTTP or HTTPS page first.'));
    if (action === 'search') return openOptions('', { search: tab.url });
    if (action === 'cookies') return openOptions('Personas', { cookie_tab: String(tab.id), cookie_url: siteCookieSource(tab.url)!, site: siteHostname(tab.url)! });
    const host = siteHostname(tab.url)!;
    if (action === 'history') return openOptions('Import', { history_site: host });
    if (action === 'allow' || action === 'deny') {
      if (action === 'allow' && !(await browser.permissions.request({ permissions: ['tabs'], origins: [`${new URL(tab.url).protocol}//${new URL(tab.url).hostname}/*`] }))) {
        return openOptions('Configuration', { menu_status: t('Automatic archiving needs tab and site permissions. Review them before enabling this domain.') });
      }
      const config = await getConfig();
      await setConfig(siteRulePatch(config.match_urls, config.exclude_urls, config.enable_auto_archive, host, action === 'allow'));
      return openOptions('Configuration', { menu_status: action === 'deny' ? t('Automatic archiving blocked for $1.', host)
        : t('Automatic archiving enabled for $1. Previously inactive broad allow rules were not enabled.', host) });
    }
  } catch {
    // Cookie values, tokens and request errors must never be logged by menus.
    await feedback(t('Action could not be completed. Review Extension Settings; no unsaved tabs were closed.'), true);
    await openOptions('Configuration', { menu_status: t('Action could not be completed. Review permissions and server settings; unsaved tabs remain open.') });
  }
}
