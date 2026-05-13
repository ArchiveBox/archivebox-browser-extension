# ArchiveBox Browser Extension

## Extension Name

ArchiveBox

## Short Description

Preserve copies of websites locally + using your ArchiveBox server while you browse. Supports importing URLs from history / bookmarks + exporting CSV/JSON/PNG/HTML/ZIP.

## Long Description

Preserve copies of websites using your ArchiveBox server while you browse.
Don't let big tech keep all your data for themselves, take back ownership of your data!

- 📸 Capture a local snapshot and send URLs to your ArchiveBox server with 1 click
- 🏷️ Add and manage tags to organize your saved bookmarks
- ⚙️ Set up match patterns to automatically include or exclude URLs from your archive
- 📥 Bulk import URLs to archive from browsing history or bookmarks
- 📤 Export data easily as CSV/JSON/PNG/HTML/ZIP
- 🎯 Supports both older ArchiveBox v0.7.4 and newer >v0.8.5 servers

You can set up ArchiveBox to automatically push your browsing history to an ArchiveBox instance based on a set of criteria (specific domains or URLs matching regexes). You can also add pages manually to your ArchiveBox through the context menu.

## URLs

- Main URL: https://github.com/ArchiveBox/archivebox-browser-extension
- Support: https://github.com/ArchiveBox/archivebox-browser-extension/issues
- Privacy Policy: https://github.com/ArchiveBox/archivebox-browser-extension#privacy--permissions

## Search Terms & Tags

archivebox, archive, bookmarks, history, save page, self hosted, archiving, capture, snapshot, html, scrape

## Category

Productivity

## Languages Supported

- English (en US)  [primary]
- Spanish (es)
- Chinese (zh_CN)

---

## Reviewer Notes

This extension can optionally be configured to upload captures to a user-provided self-hosted ArchiveBox instance.
There is no public, shared, or paid ArchiveBox service. ArchiveBox is exclusively self-hosted, so you won't be able to test the server upload feature unless you set up a local instance.

The extension is completely open source under the MIT license and built using WXT + React. Full source code is available at: https://github.com/ArchiveBox/archivebox-browser-extension

## Required Permissions

- activeTab: Needed to archive the current tab when the user clicks the action button or context menu item.
- contextMenus: Needed to expose the right-click option to archive the current page.
- scripting: Needed to inject the extension UI and local capture helper into the current tab after the user clicks the action button or context menu item. The extension does not register an always-on content script.
- storage: Used for extension-local settings, saved URL metadata, capture metadata, and cached UI state. Screenshot, MHTML, and HTML capture files are written to extension-local OPFS.

Required permissions by browser:

- Chrome and Edge: storage, activeTab, contextMenus, scripting.
- Firefox and Safari: storage, activeTab, contextMenus, scripting.
- Firefox data collection declaration: required browsingActivity; optional bookmarksInfo and websiteContent.

## Optional Permissions

These permissions are requested only when needed, on first use of the specific feature:

- cookies: Used for the optional cookie import feature, which allows archiving authenticated content.
- history: Used for the optional import URLs from history feature.
- bookmarks: Used for the optional import URLs from bookmarks feature.
- tabs: Used for the optional automatic archiving feature based on configured URL regex patterns, to detect navigation to a URL that should be archived.
- unlimitedStorage: Requested only in Chrome and Edge builds for larger screenshots, MHTML, and HTML captures in extension-local OPFS. Firefox and Safari builds do not request this permission; they use browser storage persistence APIs where available.
- pageCapture: Requested only in Chrome and Edge builds when the user enables or runs local MHTML capture via chrome.pageCapture.saveAsMHTML(). Firefox and Safari builds do not request this permission because those browsers do not expose this API.

Optional host permissions:

- <all_urls>: Requested only when needed. The extension requests the exact user-provided ArchiveBox server origin before communicating with that server. It requests broader <all_urls> access only when the user enables automatic archiving, because automatic archiving must detect and capture arbitrary pages based on user-configured URL regex patterns.
