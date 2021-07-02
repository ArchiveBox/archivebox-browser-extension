# 🗃 ArchiveBox Exporter Browser Extension

This is a browser extension (works in Chrome, Firefox, and Chrome-like browsers) that lets you automatically send pages from domains you specify to your ArchiveBox instance. This has a couple of benefits:

- You have a fulltext search of your browsing history ready at your fingertips
- Prevent link rot for important information!
- Access important information even if you're offline

## Download

(These links may not work until the respective web stores review them.)

- [Chrome/Edge/Other Chromium](https://chrome.google.com/webstore/detail/habonpimjphpdnmcfkaockjnffodikoj)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/archivebox-exporter/)

> **⚠️ Note:** At the moment, the changes required for this extension to work are not yet merged into the stable release of ArchiveBox, so you will need to run the `dev` branch by following the steps [outlined here](https://github.com/ArchiveBox/ArchiveBox#install-and-run-a-specific-github-branch).

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