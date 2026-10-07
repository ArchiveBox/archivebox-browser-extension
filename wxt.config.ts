import { defineConfig } from 'wxt';
import { version } from './package.json';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {browserAssets,pythonRuntimeRevision} from './scripts/browser-assets';
import {browsertrixSource} from './scripts/browsertrix';

// The studio needs filenames, not executable hooks. Only hook-worker imports
// hook modules, so Vite does not emit a second copy for the studio bundle.
const pluginRoot = fileURLToPath(new URL('./abx-plugins/abx_plugins/plugins/', import.meta.url));
const hookPaths = readdirSync(pluginRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(({ name }) => {
  const browser = path.join(pluginRoot, name, 'browser');
  return existsSync(browser) ? readdirSync(browser).filter(file => /^on_.*\.ts$/.test(file))
    .map(file => `../../abx-plugins/abx_plugins/plugins/${name}/browser/${file}`) : [];
});


// const chromeProfile = './tmp/chrome_profile';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  manifestVersion: 3,
  vite: () => ({ plugins:[browsertrixSource()],resolve:{conditions:['onnxruntime-web-use-extern-wasm'],alias:{'node:buffer':'buffer','node:path':'path-browserify','node:events':'events','node:stream':'readable-stream','node:url':'url'}}, define: { __ABX_HOOK_PATHS__: JSON.stringify(hookPaths),__ABX_PYTHON_RUNTIME_REVISION__:JSON.stringify(pythonRuntimeRevision()) }, worker: { format: 'es' } }),

  zip: {
    excludeSources: ['tmp/**', 'dist/**', 'test-results/**', 'docs/**'],
  },
  // webExt: {
  //   chromiumProfile: chromeProfile,
  //   keepProfileChanges: true,
  // },
  hooks: {
    'build:publicAssets': (_wxt, assets) => { assets.push(...browserAssets()); },
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
      ...(['chrome', 'edge'].includes(browser) ? ['debugger', 'downloads', 'declarativeNetRequestWithHostAccess'] : []),
      'tabs',
      'contextMenus',
      ...(browser === 'safari' ? ['nativeMessaging'] : []),
      ...(['chrome', 'edge', 'firefox'].includes(browser) ? ['unlimitedStorage'] : []),
    ],
    optional_permissions: [
      ...(browser === 'firefox' ? ['geolocation'] : []),
      ...(browser !== 'safari' ? ['history', 'bookmarks'] : []),
      'cookies',
      'scripting',
    ],
    host_permissions: ['<all_urls>'],
    optional_host_permissions: ['<all_urls>'],
    sandbox: { pages: ['ytdlp-sandbox/index.html', 'ocr-sandbox.html', 'python-sandbox.html'] },
    web_accessible_resources: [
      {
        resources: ['icon/*.png', 'assets/*', 'chunks/*', 'ocr/*', 'pyodide/*', 'gallery-dl/*', 'forum-dl/*', 'papers-dl/*', 'ytdlp/*'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self';",
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
