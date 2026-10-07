# Privacy Policy

ArchiveBox Browser Extension helps you save URLs and related page metadata to your own ArchiveBox server.

## Data Stored Locally

The extension may store saved URLs, page titles, favicons, tags, crawl depth, sync status, extension settings, and local WACZ archives containing original responses, screenshots, HTTP metadata, browser logs, downloaded documents, and extracted text in browser-local extension storage.

Capture reloads the chosen tab and may scroll, expand content, dismiss modals, and fetch additional page resources, documents, and media using the browser session. Authenticated page contents can be preserved. The engine bundles its executable JS, Python, OCR models, and WASM locally. Responses are staged in IndexedDB and a finished, verified WACZ is saved in OPFS. Interrupted attempts are discarded rather than resumed. WACZ replay and derivations use recorded resources.

Closing the popup does not stop its capture tab. Deleting a capture removes its OPFS archive and disposable replay data. Browser uninstall removes local extension data; downloaded exports remain where you saved them.

## Optional Browser Data Access

The extension can optionally import URLs from browser history or bookmarks when you choose to use those import features. It can also optionally read cookies for domains you select so ArchiveBox authorization profiles can archive pages that require an authenticated session.

Persona settings can include your browser's user agent, language, timezone, display size, and light or dark mode preference. Detect Settings can also request your location, with your browser's permission.

## Data Sent To ArchiveBox

When you save or sync a page, the extension sends the selected URL and related metadata to the ArchiveBox server URL you configure. If you choose to export cookies or use an authorization profile, selected cookies may also be sent to your configured ArchiveBox server.

After you sync cookies for a domain, the extension automatically syncs subsequent cookie changes for that domain to the same server. Remove the domain from the persona or clear its cookies and sync to stop syncing those cookies. Persona settings, including location if you grant access and include it, are sent when you sync the persona. Legacy standalone captures may still be uploaded under existing settings.

Server Sync uploads a completed WACZ, including its original responses, screenshots, HTTP metadata, browser logs, downloaded documents, extracted text, and capture records, to the configured server as one `wacz` ArchiveResult. Delivery can finish after the popup closes. Local WACZ files remain available until you explicitly delete them.

## Third Parties

ArchiveBox Browser Extension does not sell user data, does not use user data for advertising, and does not transfer user data to unrelated third parties. Data is only stored locally in the browser or sent to the ArchiveBox server configured by the user for the extension's archival purpose.

## Contact

For questions or issues, use the ArchiveBox browser extension issue tracker:
https://github.com/ArchiveBox/archivebox-browser-extension/issues
