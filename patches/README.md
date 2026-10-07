# Webrecorder HEAD evidence indexing

`@webrecorder__wabac@2.27.3.patch` applies to the exact npm package version and
integrity pinned in `pnpm-lock.yaml`. Upstream source:
https://github.com/webrecorder/wabac.js/blob/281e9bc7affba4ce520301b10723b01f661aa7e5/src/cdxloader.ts
(the published package's npm `gitHead`).

The indexing behavior change is in `CDXFromWARCLoader.addCdx`: keep HEAD entries
instead of dropping them alongside OPTIONS. OPTIONS remains unchanged. The
matching expression is patched in both published runtime bundles (`dist/swlib.js`
and `dist/sw.js`); their minified lines make the diff larger than the source edit.
Upstream's existing `appendRequestQuery` then assigns the HEAD request its own
method-qualified index URL, so it cannot replace or satisfy a GET lookup.
No CDX parser, WARC reader, payload resolver, or index is replaced.

Observed failure: a real Commons gallery capture preserved all 76 records in
WARC, including two HEAD probes used by gallery-dl's Wikimedia API discovery.
Upstream loaded only 74 into its replay index. Our strict sealing check correctly
refused to discard the recoverable capture database. Retaining HEAD in that same
upstream index permits both exact sealing verification and replay of the original
API-discovery responses by the source-ported extractor. WARC loading and ordinary
GET replay are unchanged. `tests/gallery-source-live.test.ts` exercises the real
public Commons capture, WARC request methods and offline extraction.

The upstream AGPL-3.0-or-later license remains in the patched package. This is a
local source modification, not an upstream release or a claim that the unmodified
ReplayWeb.page library indexes HEAD records.

The service-worker library also exports its existing `SingleRecordWARCLoader`
class (source, type declaration and published runtime export). Its parser is
unchanged. Plugin header queries feed this loader fully consumed 64 KiB ZIP
ranges, so stopping after headers cannot retain an unread large HTTP stream.
The original WARC parser handles compression, HTTP headers, resource records,
revisits and metadata exactly as in ordinary replay.

`FetchRangeLoader` now uses the browser's `default` cache mode for its existing
HEAD and byte-range requests instead of `no-store`. This respects the WACZ
server's Cache-Control, ETag and Content-Range headers while retaining upstream
ZIP/CDX seeking. The TypeScript source and its three published bundles carry the
same change. No extracted payload cache or whole-file download is introduced.

The existing HTML rewriter also switches its parse5 tokenizer to DATA mode inside
`noscript`, allowing the same URL/CSS handlers to rewrite fallback markup.
Otherwise parse5 emits that content verbatim; Chromium's script-disabled replay
then requests its original URLs. The retained Commons all-card test reproduced
an unrewritten CentralAutoLogin tracking image. This change keeps that fallback
request inside replay, without adding another HTML parser or live fallback.

The classic JavaScript rewriter preserves a single global binding for top-level
function declarations. Its replay block previously gave ordinary functions an
Annex B outer copy that did not follow later reassignment, and hid async and
generator declarations entirely. In a real Google Sheets capture, a stale global
lazy initializer reset the menu action registry, causing `undefined.Hl` during
startup; another script could not access the top-level async function `hul`.
The existing Acorn pass now moves these declarations to anonymous function
expressions initialized at the beginning of the replay scope, with script-level
`var` bindings. This preserves declaration hoisting and the replay globals in
their closures while keeping subsequent assignments visible across scripts.
Edits are assembled in one pass. The TypeScript source and all three published
bundles carry the same change; archived source bytes remain unchanged.

The on-demand payload reader compares original URL query fields with
`URLSearchParams`, preserving their order, repeated names and values. POST CDX
keys can serialize spaces as `+` where the WARC URI uses `%20`; their appended
request-body query can also end with a truncated percent escape. The existing
whole-key `decodeURIComponent` comparison either rejected those identical
original URLs or threw. Only the original query fields are compared, and any
remaining fields must begin with the exact `__wb_method` boundary. Origins,
paths, fragments, literal plus signs and original query values must still match;
the previous loose URL-prefix acceptance is removed. The source and both
published payload-reader bundles carry the change. The retained real Drive
all-plugin capture exercises two affected 204 POST revisits in
`tests/replay-payloads-live.test.ts`, which reads every indexed payload through
the production endpoint, verifies its digest and checks the original archive is
unchanged.

## Wombat document.write values

`@webrecorder__wombat@3.10.8.patch` converts the single argument to
`document.write`/`writeln` to its string value before the existing HTML rewriter
inspects it. These APIs accept `TrustedHTML` as well as strings
([HTML Standard](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#document-write-steps)).
Google Slides and Drawings pass a `TrustedHTML` object; the upstream wrapper
called `indexOf` on that object and stopped the editor's initialization. Source,
published Wombat runtime, and the Wombat text embedded in both Wabac service
worker bundles have the same correction. The existing replay rewriting and CSP
remain in place.

## SingleFile extension replay URLs

`single-file-core@1.6.24.patch` extends upstream's two resource URL validators to
accept `chrome-extension://`. The unmodified core otherwise drops extension
replay resources before calling its supported fetch adapter. That adapter still
restricts reads to this player's WACZ replay paths (and existing inline data).
No saving, CSS, font, image, or HTML processing is reimplemented.
