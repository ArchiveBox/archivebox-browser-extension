import { siteHostname } from './siteRules';

const toolbarPrefix = 'archivebox-action-';
const pagePrefix = 'archivebox-page-';
export const pageSaveId = 'save_to_archivebox_ctxmenu';

const search = '🔎 Search for current URL in archive';
const siteActions = [
  ['allow', '✅ Always archive URLs on this domain'],
  ['deny', '⛔ Never archive URLs on this domain'],
  ['site-separator', ''],
  ['cookies', '🍪 Save site login Cookies to your Persona'],
  ['history', '🕘 Save last 90d of visits on this site'],
] as const;

type MenuItem = {
  id: string;
  title: string;
  context: 'action' | 'page';
  parentId?: string;
};

export function actionMenuItems(): MenuItem[] {
  const toolbar = (id: string, title: string, parentId?: string): MenuItem => ({
    id: toolbarPrefix + id, title, context: 'action', ...(parentId ? { parentId: toolbarPrefix + parentId } : {}),
  });
  const page = (id: string, title: string): MenuItem => ({ id: pagePrefix + id, title, context: 'page' });
  return [
    { id: pageSaveId, title: 'Save to ArchiveBox', context: 'page' },
    page('search', search),
    // The browser already groups these page entries under ArchiveBox.
    ...siteActions.map(([id, title]) => page(id, title)),
    // Chromium renders at most SIX action-menu roots.
    toolbar('save', '💾 Save current tab only'),
    toolbar('save-all', '📚 Save all tabs in this window'),
    toolbar('close-all', '🧹 Save + close all tabs in this window'),
    toolbar('search', search),
    toolbar('site', '🌐 This site'),
    ...siteActions.map(([id, title]) => toolbar(id, title, 'site')),
    toolbar('extension', '❓ Help'),
    toolbar('website', '🌐 Website', 'extension'),
    toolbar('github', '💻 Github', 'extension'),
    toolbar('bug', '🐛 Report a bug', 'extension'),
    toolbar('mobile', '📱 Setup on Mobile', 'extension'),
    toolbar('extension-separator', '', 'extension'),
    toolbar('admin', '🏛 Server Admin UI', 'extension'),
    toolbar('settings', '⚙ Extension Settings', 'extension'),
    toolbar('collection', '🗃 Collection', 'extension'),
  ];
}

export function menuAction(id: string): { action: string; page: boolean } | undefined {
  if (id === pageSaveId) return { action: 'save', page: false };
  if (id.startsWith(toolbarPrefix)) return { action: id.slice(toolbarPrefix.length), page: false };
  if (!id.startsWith(pagePrefix)) return;
  const action = id.slice(pagePrefix.length);
  if (action === 'search' || siteActions.some(([name, title]) => name === action && title)) return { action, page: true };
}

export function isClickedPageTab(
  tab: { id?: number; url?: string; incognito?: boolean; pendingUrl?: string } | undefined,
  pageUrl?: string,
): boolean {
  // Do not use frameUrl, linkUrl, or whichever other tab is currently active.
  // Compare the click's top-level document with its accompanying tab snapshot.
  return Boolean(tab && typeof tab.id === 'number' && tab.id >= 0 && !tab.incognito && pageUrl
    && siteHostname(pageUrl) && tab.url === pageUrl && (!tab.pendingUrl || tab.pendingUrl === pageUrl));
}
