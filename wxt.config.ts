import { defineConfig } from 'wxt';

// const chromeProfile = './tmp/chrome_profile';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  manifestVersion: 3,
  // webExt: {
  //   chromiumProfile: chromeProfile,
  //   keepProfileChanges: true,
  // },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.content_scripts?.length === 0) {
        delete manifest.content_scripts;
      }
    },
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    version: '3.2.0',
    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      ...(['chrome', 'edge', 'firefox'].includes(browser) ? ['unlimitedStorage'] : []),
    ],
    optional_permissions: [
      'cookies',
      'history',
      'bookmarks',
      'tabs',
      'scripting',
      ...(['chrome', 'edge'].includes(browser) ? ['pageCapture'] : []),
    ],
    optional_host_permissions: ['<all_urls>'],
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
      default_title: '__MSG_actionTitle__',
      default_popup: '/popup.html',
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
    },
    commands: {
      'save-to-archivebox-action': {
        description: '__MSG_commandSaveToArchiveBox__',
        suggested_key: {
          default: 'Ctrl+Shift+X',
          mac: 'Command+Shift+X',
        },
      },
    },
    ...(browser === 'firefox' ? {
      browser_specific_settings: {
        gecko: {
          id: 'archivebox@tjhorner.dev',
          data_collection_permissions: {
            required: ['browsingActivity'],
            optional: ['bookmarksInfo', 'websiteContent'],
          },
        },
      },
    } : {}),
  }),
});
