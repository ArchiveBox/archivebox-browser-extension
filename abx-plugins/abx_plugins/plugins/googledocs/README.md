# Google Docs browser plugin

Source port of the canonical `abx-plugins/googledocs` JavaScript hook, helpers,
config, card and full viewer (2026-10-04). The upstream plugin license is retained
under vendor/archivebox/PLUGINS-LICENSE. Canonical files were read, not modified.

Supports Docs (DOCX, PDF, ODT, RTF, TXT, Markdown, HTML ZIP, EPUB), Sheets (XLSX,
CSV, PDF, ODS, TSV, HTML ZIP), Slides (PPTX, PDF, ODP, TXT), and Drawings (SVG,
PDF, PNG, JPG). The canonical defaults are preserved. GOOGLEDOCS_FORMATS accepts
an array, JSON array, or the studio's comma-separated list. CSV/TSV exports every
sheet discovered from the editor's existing embedded model; no active-sheet-only
fallback. Resource keys, account selectors and selected sheet survive redirects.

Downloads use `ctx.archive.fetch(url, {browserSession:true})`, sharing recorder
reuse/deduplication while Chrome supplies its document-session cookies and cache.
HTTP errors and invalid signatures/MIME types fail the hook without discarding
successful exports. No export body is copied to a plugin directory. Hook data
records document/sheet identity, output names, original response references and
errors. The original viewer derives sizes from response headers and resolves
formats through Webrecorder. PDFs use transient original-byte Blob URLs for the
native PDF viewer; images remain normal replay URLs. Cards read only hook data.
Sheets initially display the selected sheet's CSV table. The full viewer fills
the replay viewport without the original standalone page's padded container.

Published `/d/e/` URLs, Forms, Apps Script, Vids and arbitrary Drive files are not
supported by this canonical plugin. A Drive link is eligible only when the live
tab resolves to a supported Workspace document.

`tests/googledocs-live.test.ts` exercises real public Docs, multi-sheet Sheets,
Slides and Drawings using all plugins, all supported exports, WACZ deduplication,
offline re-import, original format/sheet controls and byte downloads.
