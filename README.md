# 🗃 ArchiveBox Browser Extension

This is a browser extension (works in Chrome, Firefox, and Chrome-like browsers) that lets you automatically send pages from domains you specify to your ArchiveBox instance. This has a couple of benefits:

- You have a fulltext search of your browsing history ready at your fingertips
- Prevent link rot for important information!
- Access important information even if you're offline

<img width="426" alt="Screenshot of extension config area" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/82d6ae08-6327-45ef-a536-cb775ec58b41">

## Download

- [Chrome/Edge/Other Chromium](https://chrome.google.com/webstore/detail/habonpimjphpdnmcfkaockjnffodikoj)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/archivebox-exporter/)


## Features

- Different archive modes
  - Allowlist mode doesn't archive pages by default, and lets you specify domains or regexes to archive
  - Blocklist mode archives all visited pages by default, but lets you specify domains or regexes to not archive
- Archive any arbitrary page with the "Archive Current Page" context menu item
- Archive any link with the "Archive Link" context menu item

## Development

If you wish to contribute to (or just build for yourself) this extension, you will need to download and install [Node.js](https://nodejs.org/en/).

Once that's installed, navigate to this project's root and run `npm install` to install dependencies.

To build a production version (minified, optimized, etc.), run `npm run build`.

If you plan on making changes often, you can use the command `npm run dev` to automatically rebuild the extension as you modify files.

Both commands will produce an output in the `dist` directory.

## License

MIT
