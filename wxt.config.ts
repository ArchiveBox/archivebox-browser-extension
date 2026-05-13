import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'ArchiveBox',
    description: 'Collect URLs and preserve them using a remote ArchiveBox server',
    version: '3.0.1',
    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      ...(browser === 'chrome' ? ['pageCapture'] : []),
    ],
    optional_permissions: [
      'cookies',
      'history',
      'bookmarks',
      'tabs',
      'unlimitedStorage',
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['icon/*.png'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
    action: {
      default_title: 'Save to ArchiveBox',
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
    },
    commands: {
      'save-to-archivebox-action': {
        description: 'Save URL to ArchiveBox',
        suggested_key: {
          default: 'Ctrl+Shift+X',
          mac: 'Command+Shift+X',
        },
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'archivebox@tjhorner.dev',
        data_collection_permissions: {
          required: ['browsingActivity'],
          optional: ['bookmarksInfo', 'websiteContent'],
        },
      },
    },
  }),
});
