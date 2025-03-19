import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    watch: {
      ignored: ['!src/**', '!public/**'], // Ensure Vite watches both directories
    }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.js'),
        content: resolve(__dirname, 'src/content.js'),
        popup: resolve(__dirname, 'src/popup.js'),
        utils: resolve(__dirname, 'src/utils.js'),
        options: resolve(__dirname, 'src/options.js'),
        configTab: resolve(__dirname, 'src/config-tab.js'),
        cookiesTab: resolve(__dirname, 'src/cookies-tab.js'),
        entriesTab: resolve(__dirname, 'src/entries-tab.js'),
        importTab: resolve(__dirname, 'src/import-tab.js'),
        personasTab: resolve(__dirname, 'src/personas-tab.js'),
        s3Tab: resolve(__dirname, 'src/s3-tab.js')
      },
      output: {
        // All built JS files will be output at the root as [name].js
        entryFileNames: '[name].js'
      }
    },
    outDir: 'dist'
  }
});
