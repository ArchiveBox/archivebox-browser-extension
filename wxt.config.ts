import { defineConfig } from 'wxt';
import path from 'node:path';
import { version } from './package.json';

// const chromeProfile = './tmp/chrome_profile';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  manifestVersion: 3,
  // Chrome rejects literal Unicode noncharacters (Dexie's \uffff key sentinel)
  // in injected scripts. Keep their equivalent JavaScript escape sequences.
  vite: () => ({
    build: { rolldownOptions: { output: { minify: { codegen: { asciiOnly: true } } } } },
    plugins: [{
      // wa-sqlite's fallback `new URL('wa-sqlite-async.wasm', import.meta.url)`
      // makes Vite inline the 2 MB wasm as base64 into each bundle. It is never
      // used (src/lib/sqlite.ts passes locateFile), so drop it before Vite sees it.
      name: 'archivebox-wa-sqlite-wasm-url',
      enforce: 'pre' as const,
      transform(code: string, id: string) {
        if (!id.includes('wa-sqlite-async.mjs')) return;
        const fallback = 'new URL("wa-sqlite-async.wasm",import.meta.url).href';
        if (!code.includes(fallback)) throw new Error('wa-sqlite wasm fallback changed; update wxt.config.ts');
        return code.replace(fallback, '""');
      },
    }],
  }),
  zip: {
    excludeSources: ['tmp/**', 'dist/**', 'test-results/**', 'docs/**'],
  },
  // webExt: {
  //   chromiumProfile: chromeProfile,
  //   keepProfileChanges: true,
  // },
  hooks: {
    // SQLite's wasm ships once as a plain extension file. Imported through
    // Vite it would be inlined as base64 into every bundle that opens the
    // database (src/lib/sqlite.ts loads it by runtime URL instead). It goes in
    // assets/ because the iOS/macOS app bundles that folder whole, while
    // root-level files must each be listed in its Xcode project.
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: path.resolve('node_modules/@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm'), relativeDest: 'assets/wa-sqlite-async.wasm' });
    },
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
    version,
    permissions: [
      'storage',
      'alarms',
      'activeTab',
      ...(['chrome', 'edge'].includes(browser) ? ['pageCapture'] : []),
      'contextMenus',
      ...(browser === 'safari' ? ['nativeMessaging'] : []),
      ...(['chrome', 'edge', 'firefox'].includes(browser) ? ['unlimitedStorage'] : []),
    ],
    optional_permissions: [
      ...(browser === 'firefox' ? ['geolocation'] : []),
      ...(browser !== 'safari' ? ['history', 'bookmarks'] : []),
      'cookies',
      'tabs',
      'scripting',
    ],
    optional_host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['icon/*.png'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
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
