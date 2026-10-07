# Responses and LiteParse card previews

`ResourceCardPreview.tsx` adapts the unchanged canonical templates retained at:

- `vendor/archivebox/plugins/responses/card.html`
- `vendor/archivebox/plugins/liteparse/card.html`

Their exact vendored bytes are identified in `vendor/archivebox/SHA256SUMS`; origin is canonical abx-plugins HEAD `477ccfe842deaa395fd71118115a85375365da64` plus the recorded working-checkout template bytes. `vendor/archivebox/PLUGINS-LICENSE` applies. Grid opening markup and all tile CSS strings are read directly from those templates; no template scripts or Django expressions execute.

Preserved behavior: 3×3 grid; original-file-size descending/name tie ordering; nine-item bound; responses hash/URL deduplication; LiteParse-derived original ordering; document glyphs versus original images; two-column original/text LiteParse tiles; 2,000-character excerpt; canonical empty messages and response summary.

WACZ adaptations:

- `output_files`, `responses/index.jsonl`, safe filesystem paths and source-name hints are replaced by actual `ArchiveReader` original HTTP entries and their explicit URL/timestamp references. Derived evidence URNs are excluded. Images use Webrecorder `recordURL`, never live URLs, data URLs or generated substitutes.
- Original size comes from a valid unencoded response Content-Length; unknown sizes remain zero for ordering without reading the complete payload just to paint a card. Compressed WARC index length is never presented as original file size. WARC payload digest replaces responseSha256 as the content identity key.
- The LiteParse capture hook calls upstream LiteParse WASM and PaddleOCR.js (see `vendor/ocr/NOTICE.md`) and saves one JSON result per unique input body. Cards and the full viewer read these saved results without starting OCR. LiteParse metadata supplies exact source sizes, names, dimensions, digests and response/member references. Original ZIP-member image previews use transient Blobs of their exact bytes. Responses excludes one-pixel spacer previews while retaining those resources in its inspector. The snapshot hosts these inline DOM cards directly, then updates the stack-cover clones.
- Original filenames are URL path basenames, with PDF extension determined by its recorded MIME when URL paths have no file extension. Sanitization follows the exact canonical card expression. Native timestamped capture-path tie-breakers use the original URL in this storage format.
- Per-ArchiveReader promises share original metadata and saved OCR results between the two cards. The enclosing sizing div is the host adapter; its children are canonical card nodes. Parent code owns overlay preservation, fallback lifetime and updating stack-cover clones after asynchronous resolution.

This is a canonical thumbnail presentation adapter, not a claim of native LiteParse extractor parity. Runtime verification belongs to the containing snapshot integration; compilation alone does not establish rendering correctness.
