# LiteParse full viewer

`DocumentPreview.tsx` loads the unchanged `vendor/archivebox/plugins/liteparse/full.html`, removes its inline script, and supplies the plugin icon. Its markup and CSS are used directly. `vendor/archivebox/PLUGINS-LICENSE` applies.

`liteparse-template.js` ports the original inline script's file search/filter controls, original/text comparison tiles, source URL copy buttons, dimensions and Original/TXT/JSON actions into a compiled initializer. WACZ record URLs replace filesystem paths. Saved OCR JSON supplies text and JSON downloads; the viewer never starts a parser. Original response images use Webrecorder replay. Original PDFs use transient Blobs of their exact archived bytes because Chromium's native PDF viewer bypasses the replay service worker. ZIP-member PDFs and images are read from their original parent response and exposed as transient Blobs; no extracted bytes are persisted. No image is converted to a data URL.

The outer iframe contains only this trusted template UI, so it is not sandboxed: sandboxing it prevents Chromium's PDF plugin from rendering the original. Archived HTML is never inserted there. The separate OCR execution frame remains sandboxed and unprivileged.
