# ArchiveBox snapshot presentation

Source: canonical ArchiveBox and abx-plugins checkouts, 2026-10-03. Original snapshot templates, output taxonomy, plugin configs and templates are retained with SHA256SUMS. snapshot.css is their CSS inside a CSS @scope (body-level .snapshot-stacks selectors target :scope.snapshot-stacks). stacks.js is the original stack controller with a scoped root, supplied preview callback, disposal, and server-only orphan file discovery removed. WACZ entries provide the Other files inventory. SnapshotDetail ports template markup and data binding; plugin templates keep their own viewers. No Django runtime or saved derived report files are required.

Source checkout HEADs at vendoring: ArchiveBox `da52653575b7624b2197ca609c9d7408514537cb`; abx-plugins `477ccfe842deaa395fd71118115a85375365da64`. Template bytes are identified by SHA256SUMS. Server-only source-selection clauses and dependencies for omitted plugins are removed from these local templates and configs. abx-plugins copyright is retained in PLUGINS-LICENSE.

SEO uses the literal vendored `plugins/seo/full.html` document and styles with
its script compiled in `src/ui/seo-template.ts`. The original DOM construction,
field precedence, badges, social links, image error handling and SVG icons are
retained. The shared canonical wrapper supplies the derived JSON and output
actions; exact WACZ response references replace Django's response/favicon file
lists. No featured-image copy or generated SEO report is stored in the WACZ.

Console and Hashes retain their literal vendored full documents and styles.
`src/ui/console-template.js` and `src/ui/hashes-template.js` compile their
original inline renderers, replacing filesystem fetches with transient data.
Console rows are derived from captured CDP events; hash-tree leaves are the
WACZ manifest's actual package member paths, byte counts, and SHA-256 digests.
The canonical Merkle construction combines adjacent hexadecimal leaf hashes,
duplicating the last leaf for odd levels, as the original hashes hook does.
Opening the viewer does not re-read or duplicate archived payloads.

SSL Certificates and Accessibility likewise use their literal full documents
and compiled original renderers (`src/ui/sslcerts-template.ts` and
`src/ui/accessibility-template.ts`). Existing X.509 and CDP/DOM adapters supply
the canonical models. Certificate PEM actions use transient URLs for the
original DER-derived PEM strings, released on unmount; no additional PEM files
are captured. The separate React metadata layouts and copied stylesheets were
removed.

The shared directory browser uses ArchiveBox's `templates/static/directory_index.html`
(vendored 2026-10-05) for its literal styles, header, and table markup.
`src/ui/directory-browser.ts` ports the same navigation, filtering, sorting,
and lazy previews, with archived-resource callbacks and client-side ZIP downloads.
It serves plugin file lists, Git checkouts, Drive/Dropbox folders, and nested ZIPs;
the former plugin directory renderers and their inline template scripts/styles
have been removed. Preview eligibility follows `archivebox/misc/serve_static.py`.
The directory template retains the upstream CSS and static markup; Django row
rendering and the original inline script are removed because the shared UI now
handles those duties. The upstream template SHA-256 before adapting it is
`350362c8138a39254d5bf8ee5ae0fcc8468224e17987d10f68db073fb4da9601`.

Metadata cards use the same compiled canonical renderers as their full viewers,
through `src/archive/cards.ts`. Preview mode limits data and visible rows while
retaining the original card.html scaling and full.html structure. Accessibility
cards show the source document outline without launching native AX rendering;
hashes cards use the package manifest without reading response bodies.
