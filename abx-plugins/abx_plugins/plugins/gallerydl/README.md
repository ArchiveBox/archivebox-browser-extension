# gallery-dl

Runs the unchanged gallery-dl 1.32.15 Python engine through packaged Pyodide. All 306 upstream extractor modules (1,034 classes) ship in the extension; the matching extractor and native recursive DataJob produce metadata and original file URLs.

The shared recorder acquires HTTP responses and original files. Requests methods, bodies and end-to-end headers are preserved through the browser transport; browser session cookies apply. `GALLERYDL_CONFIG` is upstream JSON configuration. Explicit request/byte limits fail when reached. Metadata is regenerated offline from WACZ when the viewer opens, and images use Webrecorder URLs rather than data URLs or a duplicated resource tree.

Bundled classes are broader than validated runtime support. Native processes, external downloader/assembly, interactive OAuth, browser cookie-database reads and unavailable optional packages remain unsupported. See [provenance and runtime boundaries](../../../../vendor/gallery-dl/README.md) and `tests/gallery-upstream-live.test.ts` for real-site acceptance.
