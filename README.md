# 🗃 ArchiveBox Browser Extension

This is a browser extension (works in Chrome, Firefox, and Chrome-like browsers) that lets you automatically send pages from domains you specify to your ArchiveBox instance. This has a couple of benefits:

- You have a fulltext search of your browsing history ready at your fingertips
- Prevent link rot for important information!
- Access important information even if you're offline

## Download

- [Chrome/Edge/Other Chromium](https://chrome.google.com/webstore/detail/habonpimjphpdnmcfkaockjnffodikoj)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/archivebox-exporter/)

## Setup

1. Set up an [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox#quickstart) server and make sure it's accessible to the machine you're browsing on
2. Configure your ArchiveBox server to allow URL submissions without requiring login ([more info here...](https://github.com/ArchiveBox/ArchiveBox/wiki/Configuration#public_index--public_snapshots--public_add_view))
    ```bash
    archivebox config --set PUBLIC_ADD_VIEW=True
    # (make sure to restart the server after to apply this change)
    ```
    <img width="400" alt="Screenshot of ArchiveBox CLI configuring PUBLIC_ADD_VIEW=True" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/b0dc715c-4f88-49dd-a019-ffd65ebcc7c4">
3. Configure the extension to point to your ArchiveBox server's base URL (e.g. `http://localhost:8000`, `https://archivebox.example.com`, etc.)  
    <img width="400" alt="Screenshot of extension config area: example with localhost" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/43673b8c-389d-45f7-9cda-f1ec72844a00" align="top"><img width="350" alt="Screenshot of extension config area: example with demo" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/82d6ae08-6327-45ef-a536-cb775ec58b41" align="top">
5. ✅ *Test it out by right-clicking on any page and selecting `ArchiveBox Exporter > Archive Current Page`*  
    <img width="400" alt="Screenshot of right-clicking to add a page to ArchiveBox using extension" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/6c0b8125-e1b9-4c64-b79a-c74a8d85c176" align="top"><img width="600" alt="Screenshot of ArchiveBox server with added URL" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/ab2dc48a-e2cd-4bef-aea3-553a91bc70c9" align="top">


## Features

- Different archive modes
  - Allowlist mode doesn't archive pages by default, and lets you specify domains or regexes to archive
  - Blocklist mode archives all visited pages by default, but lets you specify domains or regexes to not archive
- Archive any arbitrary page with the "Archive Current Page" context menu item
- Archive any link with the "Archive Link" context menu item

---

## Development

If you wish to contribute to (or just build for yourself) this extension, you will need to download and install [Node.js](https://nodejs.org/en/).

Once that's installed, navigate to this project's root and run `npm install` to install dependencies.

To build a production version (minified, optimized, etc.), run `npm run build`.

If you plan on making changes often, you can use the command `npm run dev` to automatically rebuild the extension as you modify files.

Both commands will produce an output in the `dist` directory.

## Changelog

#### 2024-01 Extension repo moved from `tjhorner/archivebox-exporter` to `Archivebox/archivebox-extension`

https://github.com/ArchiveBox/archivebox-extension

#### 2021-09 Extension offically supported by ArchiveBox v0.6.2, no longer needed to run `:dev` branch

https://github.com/tjhorner/ArchiveBox.git#temporary-add-api

#### 2021-07 Initial extension published on Chrome and Mozilla web stores

https://github.com/ArchiveBox/ArchiveBox/issues/577#issuecomment-872915877

#### 2021-06 [@tjhorner](https://github.com/tjhorner) Created the initial `archivebox-exporter` extension

https://github.com/ArchiveBox/ArchiveBox/issues/577

## Related Projects



- https://github.com/layderv/archivefox (user-contributed extension for Firefox)
- https://github.com/Gertje823/ArchiveboxTelegramBot (Telegram Bot to send URLs to ArchiveBox)
- https://github.com/TheCakeIsNaOH/xbs-to-archivebox (Download your bookmarks from xBrowserSync, filter them, and save them into ArchiveBox)
- https://github.com/emschu/archivebox-quick-add (golang utility to add links to ArchiveBox)
- https://github.com/FracturedCode/archivebox-reddit (automatically back up saved Reddit comments, posts, etc. to ArchiveBox)
- https://github.com/thomaspaulin/archive-box-bridge (simple Golang server that accepts URLs and passes them on to ArchiveBox)
- https://github.com/dbeley/reddit_export_userdata (older Python utility to archive reddit content to ArchiveBox)
- https://github.com/gildas-lormeau/SingleFile (a great extension for saving pages into a single `.html` file, built-in to ArchiveBox already)

---

## License

MIT License
