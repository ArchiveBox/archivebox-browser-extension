# Unchanged gallery-dl in Chromium

The pinned `gallery_dl-1.32.15-py3-none-any.whl` is the complete upstream Python distribution, including all **306 extractor modules and 1,034 extractor classes**. It is executed by packaged Pyodide 0.29.3 with JSPI; there is no rewritten site-parser selection. `provenance.json` pins every wheel URL/version/SHA-256. Wheels contain their original source and license notices. gallery-dl is GPL-2.0-only; Requests is Apache-2.0; urllib3 and idna are MIT; certifi is MPL-2.0; charset-normalizer is MIT. Upstream full sources and dependencies remain inside the distributable wheels in `public/gallery-dl`.

## Runtime integration

`bridge.py` subclasses upstream `DataJob`, using its real dispatch, configuration, predicates, metadata serialization, and recursive queue resolution. A subclass of whichever upstream extractor actually matches the URL mounts the Requests public `BaseAdapter` on the active session before calling the unchanged upstream `request`. This also handles extractors that replace their session for OAuth signing. No upstream functions, modules, classes, or global Requests session factory are monkeypatched. Site parsing remains entirely inside the wheel.

Requests continues to prepare methods, bodies, query strings, auth and headers. The adapter sends those requests through the shared recorder, returning native `requests.Response` objects with decoded body bytes, encoding and cookie extraction. Upstream sleep calls use cancellable JSPI rather than blocking the browser. Original HTTP(S) files, including extractor-provided method/body/header overrides, use that same session and transport. Every original is stored in WACZ, without creating a second filesystem mirror. Metadata is not saved: opening the gallery runs the same engine in a fresh isolated worker against original WACZ responses and returns transient directory/file metadata and Webrecorder resource references. Before reporting capture success, a second isolated runtime reads only already captured responses and must reproduce all upstream metadata and original URLs exactly; missing responses or different results fail the hook. The pre-seal validation also consumes recorded original-file responses so Requests cookie state follows the same sequence as capture. The selected gallery view uses upstream metadata-only DataJob extraction and displays the separately preserved originals directly; it does not read every image into Python again. Sites that depend on cookies set by original-file downloads during later metadata requests may require the download-enabled validation sequence. Gallery cards select the first original image reference without launching Python.

## Boundaries

Bundling the complete extractor corpus is not a claim of universal site parity. Authentication, challenges, site/API changes and external service access can fail. Native subprocesses, browser cookie-database access, interactive OAuth callback servers, filesystem postprocessors, external downloaders, yt-dlp delegates, segmented assembly and native optional Python extensions are not implemented by this adapter. A non-HTTP original is an explicit extraction failure. Imported-archive views execute in opaque sandbox-hosted Workers: local packaged assets are the only allowed direct connections, and original responses are supplied by read-only parent RPC. The real upstream filter-expression isolation case runs with Chromium online to verify CSP blocks an attempted direct remote fetch and extension APIs are absent. The standalone HTTP player retains the same opaque isolation; its static host must send `Access-Control-Allow-Origin: *` for packaged JavaScript, WASM, wheels, and runtime assets. User-entered capture configuration executes in the capture worker. Browser Fetch manages connection/TLS details; custom proxy/client-certificate/TLS-verification overrides fail explicitly. Redirect intermediates and browser cookie visibility remain transport limitations. Capture limits fail explicitly instead of reporting a complete gallery.

`extractors.json` enumerates all 1,034 classes, 273 category names, their modules and URL patterns. These are engine registrations, not validated-site counts. The old Wikimedia TypeScript implementation and partial source bundle were removed; the complete unchanged wheel is the sole engine. The full wheel also includes Wikimedia itself.

## Acceptance

`tests/gallery-upstream-live.test.ts` uses public Flickr, Wallhaven, and Wikimedia URLs, compares original filenames and URLs to the real pinned native gallery-dl CLI, then captures through the studio, exports/deletes/reimports WACZ with Chromium offline, reruns Python extraction, and verifies original images use replay with zero external requests and no data URLs. Access errors are failures, never skips. Native live Flickr and Wallhaven calls succeeded while implementing this runtime; a native Unsplash probe returned HTTP 401. The gallery uses the unchanged canonical ArchiveBox gallery template, with its script compiled against recorded file references.

Verified October 4, 2026: Flickr, Wallhaven, and Wikimedia browser cases passed native metadata/URL comparison, acquisition plus their strict recorded-only reconstruction gate, unique WARC payload/revisit checks, WACZ export/delete/offline import, byte hashes for every CDX entry, actual image replay, and zero external HTTP requests. Wikimedia additionally exercised HEAD API discovery and paginated category requests while preserving five original images (72 MB). These verify FlickrImageExtractor, WallhavenImageExtractor, and WikimediaArticleExtractor on the tested public URLs; they are not claims about all modes or bundled providers. The standalone HTTP player also passed real Wallhaven derivation and rejection of an imported upstream Python filter expression that attempted live HTTP, with the browser online and extension APIs absent.

Reproduce the browser and standalone-player checks using separate artifact directories:

```sh
pnpm compile
pnpm build
pnpm build:player
pnpm exec playwright test tests/gallery-upstream-live.test.ts --output /tmp/abx-gallery-captures
ABX_GALLERY_CAPTURE_DIR=/tmp/abx-gallery-captures pnpm exec playwright test tests/gallery-player-live.test.ts --output /tmp/abx-gallery-player
```

The player test imports those real completed captures and serves the actual built player files with CORS headers; it does not replace HTTP responses or extractor handlers.
