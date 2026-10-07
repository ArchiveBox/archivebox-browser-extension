# Upstream yt-dlp in Chromium WebAssembly

This adapter runs the unchanged upstream Python distribution in Pyodide. It does not translate site extractors. Acquisition uses a `RequestHandler` subclass selected through `YoutubeDL.build_request_director`; JSPI suspends Python while the shared recorder acquires each original response. The EJS provider subclasses the pinned upstream `EJSBaseJCP` and executes its solver in an opaque, network-disabled extension sandbox. Neither Python wheels nor JavaScript solver code are downloaded at runtime.

## Existing ports investigated

- [dlPro](https://github.com/machineonamission/dlPro), inspected at `c23ae325a38f61a8b72061487e74f8b0f3120287`, is an existing AGPL browser port using Pyodide, browser HTTP, an EJS provider and ffmpeg.wasm. It establishes feasibility. Its whole application is not embedded: it monkeypatches urllib/subprocess, updates executable dependencies remotely, and produces downloads outside our recorder. No dlPro source is copied here.
- [Pyodide JSPI](https://blog.pyodide.org/posts/jspi/) supports `run_sync` with `runPythonAsync`; the adapter uses this supported synchronous/asynchronous bridge.
- [Upstream networking failure report](https://github.com/yt-dlp/yt-dlp/issues/11957) illustrates why importing yt-dlp alone is insufficient.

## Pinned distributions

| Artifact | Source | SHA-256 |
| --- | --- | --- |
| yt_dlp-2026.8.19-py3-none-any.whl | [PyPI](https://pypi.org/project/yt-dlp/2026.8.19/) | `1d57897e94c6665a0a6f9bc54b34e584284e32c034ffab3a7df25d8f7b24eedf` |
| yt_dlp_ejs-0.8.0-py3-none-any.whl | [PyPI](https://pypi.org/project/yt-dlp-ejs/0.8.0/) | `79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4` |
| ssl-1.0.0-cp313-cp313-pyodide_2025_0_wasm32.whl | Pyodide v0.29.3 full distribution | `23a3fe862983d6798a51a0a63ac55356891751084927a7bde979dc4d6d52e0b5` |
| libopenssl-1.1.1w.zip | Pyodide v0.29.3 full distribution | `eaec7126f466a33ea4121fd230211bb01e9ad1c5748f3cd0b4b1c8677b4ac90a` |
| @ffmpeg/ffmpeg 0.12.15 | [upstream browser API](https://github.com/ffmpegwasm/ffmpeg.wasm), MIT | pinned npm integrity in pnpm-lock.yaml |
| @ffmpeg/core 0.12.10 ffmpeg-core.wasm | [upstream single-thread build](https://github.com/ffmpegwasm/ffmpeg.wasm), GPL-2.0-or-later | `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7` |

Pyodide 0.29.3 itself is pinned by the npm lockfile. Its JavaScript, WASM, stdlib and package lock are copied by the build; its package lock supplies the two matching optional-package hashes above. Upstream licenses remain inside both Python wheels; Pyodide/CPython/OpenSSL retain their respective licenses.

## Preservation and boundaries

All available manual and automatic subtitle language groups are traversed separately, including overlapping languages, using upstream best-format selection by default. Optional `YTDLP_ALL_SUBTITLE_FORMATS` fetches every original representation as well. The WACZ manifest stores only acquisition decisions, source references, selected format IDs, diagnostics and track-to-response relationships. Full extractor metadata is regenerated transiently by running the same upstream extractor against captured request identities while offline. There is no second info.json response copy or subtitle conversion during capture.

Media acquisition uses upstream's `bv*+ba/b` format selection, preserving separate video/audio originals instead of downgrading because no native ffmpeg executable is installed. Explicit upstream fragment URLs and relative paths are acquired alongside the existing HLS/DASH dependency traversal. Byte-ranged extractor fragments are still unsupported and fail explicitly. Preferred upstream artwork is acquired using the same recorded transport. Descriptions and info.json remain transient derivations of the original extractor responses.

Opening selected separate tracks in the full viewer lazily loads the packaged upstream FFmpeg worker and single-thread WASM core. The adapter source-ports the stream mapping and codec-copy operation from yt-dlp's `FFmpegMergerPP.run`; it does not re-encode video or audio. Archive bodies become local worker files, and multiple captured DASH fragments use FFmpeg's concat protocol. FFmpeg receives only local filenames with a `file,concat` protocol whitelist. The merged Blob is shared by playback and download for that mounted viewer, then released; no second movie is stored in the WACZ, and card previews never load FFmpeg. The core is GPL-2.0-or-later and the JS wrapper is MIT, compatible with this extension's existing AGPL distribution.

Native subprocesses, general ffmpeg postprocessing/transcoding, DRM decryption, external downloaders, WebSockets, RTMP and TLS impersonation remain unsupported. Browser session cookies are used; native browser-cookie database readers are not. Some Python optional dependencies are absent. Extractor errors, missing offline requests, budget exhaustion and omitted playlist entries remain explicit failures. Shipping all upstream extractors does not prove all sites work.

Extractor User-Agent, Origin, Referer, Cookie, Accept-Encoding and Sec-Fetch-Mode values use ephemeral Chrome DNR rules, scoped to exact URL, method, owner studio tab or extension no-tab request and exact extension initiator. A global per-URL/method lock isolates concurrent hooks across studios. Rules are removed on request completion/error/abort and when a studio tab closes. Unsupported transport header overrides are rejected. Redirects remain governed by Fetch, so intermediary responses and redirected header fidelity are not yet complete.

## Verification

`pnpm exec playwright test tests/ytdlp-live.test.ts` uses actual public sites and the actual studio capture/export/import flow. It compares the subtitle-positive MDN example with native pinned yt-dlp, reopens the WACZ offline and regenerates upstream metadata. No synthetic pages, replaced responses or fake handlers are used. YouTube is a required test, not skipped when blocked.

On 2026-10-04, `pnpm exec playwright test tests/ytdlp-merge-live.test.ts tests/ytdlp-live.test.ts -g 'all-plugin DASH|WASM captions'` passed both real all-plugin captures in 1.5 minutes. Each capture ran all 47 plugins and completed with no failed hooks. The MDN player preserved English, German and Spanish subtitle originals matching native upstream selection, then displayed their transcript cues after offline import. The DASH-IF HTML player test used the supported `YTDLP_FORMAT=bv*[height<=240]+ba/b` option to avoid its default 4K download; the production default remains upstream best quality. It preserved 322 original responses, including 160 video and 160 audio fragments. Offline FFmpeg produced one playable/downloadable 36,839,509-byte MP4 lasting 634.566667 seconds; native ffprobe confirmed H264 video plus AAC audio. Replay made zero original HTTP requests, and the WACZ contained no generated merged movie. Cards continue to read only the index.

Direct navigation to an `application/dash+xml` download currently aborts Chrome navigation before yt-dlp runs; the accepted DASH test captures the real HTML player that embeds that manifest. This navigation boundary remains separate from extractor and offline muxing support. Unfragmented separate-track input is implemented through the same FFmpeg adapter but has not yet received a dedicated successful browser acceptance capture.

Initial real-browser captures passed unchanged Generic, ArchiveOrg and HTML5MediaEmbed extractors. The MDN caption example exposes English, German and Spanish originals. A real httpbingo echo capture proved the exact upstream User-Agent, Accept-Encoding: identity and Sec-Fetch-Mode: navigate arrived at the server, and no DNR rules remained afterward. Initial tab-only rules did not match extension Fetch; adding Chrome's TAB_ID_NONE attribution and serializing the URL/method across studios fixed this.

YouTube then extracted the same two manual and 314 automatic/translated language groups as native yt-dlp. The exhaustive all-representations run preserved 199 subtitle resources: 14 manual resources across two languages and 185 automatic/translated resources across 29 languages. The server returned HTTP 429 after that; the run ultimately hit its 240-second hook deadline and exported a correctly partial archive. Complete all-language acquisition is NOT verified. The current source stops subsequent requests to a rate-limited origin immediately; this guard and the new best-representation default are source-reviewed, not a new successful YouTube acceptance run. No further live YouTube requests were made after rate limiting.

EJS is registered using upstream's provider interface and isolated by sandbox CSP; the successful visionOS player path did not require a JS challenge, so actual EJS challenge-solving acceptance remains outstanding. Multi-site Generic/HTML5MediaEmbed/ArchiveOrg coverage does not prove all extractors, authentication cases or native dependencies.

The browser player source-ports `ytdlp/templates/full.html` and `card.html` from the canonical abx-plugins checkout. Vendored markup/CSS/icons are unchanged; the original inline script is compiled in `src/ui/ytdlp-template.js`. Its filesystem file list and reads receive original WACZ references plus transient native metadata/subtitle derivations. Downloads read original bodies. HLS/DASH use the existing archived stream transport. The hidden `media` namespace aliases this one presentation. Cards list original files without starting Python; native unsupported outcomes render the canonical empty state immediately.
