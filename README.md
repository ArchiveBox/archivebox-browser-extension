# 🗃 ArchiveBox Browser Extension

This is a browser extension that lets you send individual browser tabs or all URLs matching certain patterns to your [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) instance for offline preservation. This has a couple of benefits:

- Own your data: save the web content that matters to you most, protect against link rot
- Protect your data: save offline copies of pages in common, durable formats that will last for generations
- Use your data: collect and tag important bookmarks, full-text search through your browsing history, automatically push captured data into other systems using ArchiveBox's APIs

## Get the Extension

- <a href="https://chrome.google.com/webstore/detail/habonpimjphpdnmcfkaockjnffodikoj"><img src="https://github.com/user-attachments/assets/4ee7d4fb-e676-4a75-973d-ac029f265b86" height="30px" align="top"/> Chrome / Brave / Other Chromium-based browsers</a>
- <img src="https://github.com/user-attachments/assets/4ee7d4fb-e676-4a75-973d-ac029f265b86" height="30px" align="top"/> Microsoft Edge *(supported; Edge Add-ons packaging is built from the same WXT codebase)*
- <a href="https://addons.mozilla.org/firefox/addon/archivebox-exporter/"><img src="https://github.com/user-attachments/assets/8e2a969d-68d6-4bd6-8b10-d8b5a36757ec" height="30px" align="top"/> Firefox / Waterfox / Tor Browser / Other Firefox-based browsers</a>
- <img src="https://github.com/user-attachments/assets/c20f8f8a-01f2-427b-ac75-ffddcb62953f" height="30px" align="top"/> Safari / iOS Safari *(supported; requires Safari Web Extension packaging for distribution)*

![configuring-server](https://github.com/user-attachments/assets/308c4462-ca09-434f-89a6-3f6bac404be2)
![url-submission](https://github.com/user-attachments/assets/cfc8f670-562a-4c17-a533-4b1b0560c5c8)
![admin-ui](https://github.com/user-attachments/assets/97d90d4c-d0f3-4bc1-b7ef-1c9e410c576f)

<img width="1367" alt="image" src="https://github.com/user-attachments/assets/393da1fa-c75a-4ab8-ae98-5745dca4683c">
<img width="2056" alt="image" src="https://github.com/user-attachments/assets/4290f090-3e33-4a12-82b8-65bafd86a2ee">

![image](https://github.com/user-attachments/assets/2977d572-9086-4ea7-a4a2-2726e762a125)
![image](https://github.com/user-attachments/assets/bb2f2bde-5c40-48e4-9499-1fada83425cf)
<img width="1402" alt="image" src="https://github.com/user-attachments/assets/aeb7ed60-d9b0-4393-8c71-2aa42921f7a2">

#### Recent Changes

- [x] updated the extension to Manifest v3 using WXT, React, and TypeScript
- [x] added a Saved URLs view where you can see, search, sort, tag, sync, delete, and export the URLs you've collected so far
- [x] added the ability to import URLs from browser history / bookmarks by date range or filter query
- [x] added the ability to export selected URLs as CSV/JSON, selected screenshots as PNG, selected MHTML snapshots as `.mhtml`, selected SingleFile captures as `.html`, or a ZIP bundle containing all selected snapshot data and local artifacts
- [x] added extension-local full-page screenshot capture for saved URLs
- [x] added extension-local MHTML capture for saved URLs on Chrome / Edge / Chromium browsers
- [x] added extension-local SingleFile HTML capture for saved URLs when the SingleFile extension is installed and approved
- [x] added the ability to edit extension config options, allowlist/denylist, ArchiveBox server URL, API key, and authentication profiles from the options page
- [x] added the ability to test the connection to your ArchiveBox server
- [x] added build and packaging support for Chrome, Edge, Firefox, and Safari from the WXT/React codebase




## Local Captures

When local capture saving is enabled in the options page, the extension stores capture artifacts in the browser's extension-local OPFS storage before the popup is shown:

- Full-page screenshot: `snapshots/YYYYMMDD/example.com/{uuid}/chrome_extension_screenshot/screenshot.png`
- MHTML snapshot: `snapshots/YYYYMMDD/example.com/{uuid}/chrome_extension_mhtml/snapshot.mhtml`
- SingleFile HTML snapshot: `snapshots/YYYYMMDD/example.com/{uuid}/chrome_extension_singlefile/snapshot.html`

Screenshots are shown as thumbnails in the Saved URLs table when at least one saved URL has a screenshot, and can be exported as PNG from the Export menu. MHTML and SingleFile HTML snapshots can also be exported from the same menu. The ZIP export includes the selected CSV/JSON metadata plus local artifacts under the same `snapshots/YYYYMMDD/example.com/{uuid}/...` paths used in OPFS. When a SingleFile HTML or MHTML snapshot is available, the Saved URLs table title opens an extension-local framed viewer for that snapshot.

MHTML capture uses Chromium's `pageCapture.saveAsMHTML()` extension API and is available in Chrome / Edge / Chromium builds. Firefox and Safari builds still save the URL and screenshot where the browser supports tab capture, but skip MHTML capture because the page capture API is not available there.

SingleFile HTML capture uses the SingleFile browser extension through its external capture API. The first request opens SingleFile's options page so the user can approve or deny ArchiveBox as an allowed caller, then subsequent captures can run silently and save the returned HTML into ArchiveBox's local OPFS snapshot tree.


## Setup

1. Set up an [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox#quickstart) server and make sure it's accessible to the machine you're browsing on
2. Configure your ArchiveBox server to allow URL submissions without requiring login ([more info here...](https://github.com/ArchiveBox/ArchiveBox/wiki/Configuration#public_index--public_snapshots--public_add_view))  
    *`>= v0.8.5`: users of the new BETA releases can use an API key generated at `/admin/api/apitoken/` instead.*  
    *Alternatively: if you stay signed in to your ArchiveBox instance in the same browser, it will share your login credentials.*
    ```bash
    archivebox config --set PUBLIC_ADD_VIEW=True
    # (make sure to restart the server after if you apply this change)
    ```
    <img width="400" alt="Screenshot of ArchiveBox CLI configuring PUBLIC_ADD_VIEW=True" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/b0dc715c-4f88-49dd-a019-ffd65ebcc7c4">
3. Configure the extension to point to your ArchiveBox server's base URL (e.g. `http://localhost:8000`, `https://archivebox.example.com`, etc.)  
    <img width="500" alt="Screenshot of extension config area: example with localhost" src="https://github.com/user-attachments/assets/308c4462-ca09-434f-89a6-3f6bac404be2" align="top"><img width="250" alt="Screenshot of extension config area: example with demo" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/82d6ae08-6327-45ef-a536-cb775ec58b41" align="top">
4. ✅ *Test it out by right-clicking on any page and selecting `Save to ArchiveBox`, or by clicking the extension icon in the menubar.*  
    <img width="400" alt="Screenshot of right-clicking to add a page to ArchiveBox using extension" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/6c0b8125-e1b9-4c64-b79a-c74a8d85c176" align="top"><img width="600" alt="Screenshot of ArchiveBox server with added URL" src="https://github.com/ArchiveBox/archivebox-extension/assets/511499/ab2dc48a-e2cd-4bef-aea3-553a91bc70c9" align="top">

---

## Development

*✨ Originally contributed by [TJ Horner (@tjhorner)](https://github.com/tjhorner), now maintained by [@benmuth](https://github.com/benmuth) and the [ArchiveBox](https://github.com/ArchiveBox) team.*

If you wish to contribute to (or just build for yourself) this extension, you will need to download and install [Node.js](https://nodejs.org/en/) and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/ArchiveBox/archivebox-browser-extension
cd archivebox-browser-extension/

pnpm install
pnpm compile
pnpm build
pnpm build:edge
pnpm build:firefox
pnpm build:safari
```

For local development:

```bash
pnpm dev           # Chrome / Chromium
pnpm dev:edge      # Edge
pnpm dev:firefox   # Firefox
pnpm dev:safari    # Safari WebExtension build
```

For a production-style local build, load `.output/chrome-mv3` into Chrome / Chromium using the [Load Unpacked Extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) UI, load `.output/edge-mv3` into Edge using `edge://extensions`, load `.output/firefox-mv3` into Firefox using `about:debugging`, or load `.output/safari-mv3` in Safari with Settings → Developer → Add Temporary Extension.

To create store upload bundles:

```bash
pnpm zip
pnpm zip:edge
pnpm zip:firefox
pnpm zip:safari
```

To submit store uploads with WXT, add the store credentials to `.env` using `.env.example` as the template, then run the matching submit script:

```bash
pnpm submit:chrome
pnpm submit:edge:dry-run
pnpm submit:edge
pnpm submit:firefox
```

Edge publishing uses WXT's Microsoft Edge Add-ons API support. Set `EDGE_PRODUCT_ID` from the Partner Center extension dashboard, plus the API credentials in `EDGE_CLIENT_ID` and `EDGE_API_KEY`.

Safari publishing is not handled by `wxt submit`. Build the Safari WebExtension output, then convert/package it for macOS and iOS/iPadOS with Apple's Safari Web Extension tooling:

```bash
pnpm convert:safari
```

For App Store/TestFlight distribution, upload the generated Xcode app project through App Store Connect, or use Apple's Safari Web Extension Packager flow.

Please open an issue to discuss any proposed changes *before* starting work on any PRs.

## Changelog

- 2026-05 Extension v3.2.1 added ArchiveBox 0.9 persona sync and server host permission fixes
- 2026-05 Extension v3.2.0 migrated to WXT, React, TypeScript, Manifest v3, local screenshot capture, Chrome / Edge MHTML capture, and SingleFile HTML capture
- 2025-03 New Manifest v3 [Extension v2.1.3](https://github.com/ArchiveBox/archivebox-browser-extension/releases/tag/v2.1.3) Released
- 2024-11 Development [started](https://github.com/ArchiveBox/archivebox-browser-extension/pull/31) on v2 extension with more advanced UI and tagging options
- 2024-01 Extension repo moved from `tjhorner/archivebox-exporter` to `Archivebox/archivebox-browser-extension`
- 2021-09 Extension offically supported by ArchiveBox v0.6.2, no longer needed to run `:dev` branch
- 2021-07 Initial extension [published](https://github.com/ArchiveBox/ArchiveBox/issues/577#issuecomment-872915877) on Chrome and Mozilla web stores
- 2021-06 [@tjhorner](https://github.com/tjhorner) [Created](https://github.com/ArchiveBox/ArchiveBox/issues/577) the initial `archivebox-exporter` extension

---

## Alternative Extensions for Archiving

Other browser extensions that also do web archiving which may be a better fit if ArchiveBox doesn't suit your needs.

- [ArchiveWeb.page](https://webrecorder.net/archivewebpage) (super high fidelity archiving extension by Webrecorder)
- [SingleFile](https://github.com/gildas-lormeau/SingleFile) (a great extension for saving pages into a single `.html` file, built-in to ArchiveBox already)
- [Hypothesis](https://web.hypothes.is/start/) (extension focused on annotating, but also supports archiving)
- [Memex](https://memex.garden/) (another project focused on annotating that supports archiving)
- [Save Page WE](https://addons.mozilla.org/en-US/firefox/addon/save-page-we/) (a Firefox extension that also saves webpages as a single HTML file)

## Other ArchiveBox Helper Projects

Other projects that help with ingest URLs into ArchiveBox from various sources.

- https://github.com/layderv/archivefox (user-contributed extension for Firefox)
- https://github.com/Gertje823/ArchiveboxTelegramBot (Telegram Bot to send URLs to ArchiveBox)
- https://github.com/TheCakeIsNaOH/xbs-to-archivebox (Download your bookmarks from xBrowserSync, filter them, and save them into ArchiveBox)
- https://github.com/emschu/archivebox-quick-add (golang utility to add links to ArchiveBox)
- https://github.com/FracturedCode/archivebox-reddit (automatically back up saved Reddit comments, posts, etc. to ArchiveBox)
- https://github.com/dbeley/reddit_export_userdata (older Python utility to archive reddit content to ArchiveBox)
- https://github.com/jess-sol/reddit-exporter (export reddit data to ArchiveBox)
- https://github.com/jonesd/archivebox-pinboard-tranformer (export links from pinboard to ArchiveBox)
- https://github.com/agg23/archivebox-url-forwarder (older WebExtension to forward URLs to archivebox)

---

## License

MIT License
