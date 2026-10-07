# Actual papers-dl 0.0.25 and pdf2doi 1.5.1 in Python/WASM

The browser runs the original Python implementations, including all three providers, identifier/ISBN parsing, embedded-PDF discovery, concurrent fetch selection, PDF-derived identifier validation, title inference, and Google search fallback. The previous TypeScript provider/parser translation is retired.

## Sources and licenses

- `upstream/`: published `papers_dl-0.0.25.tar.gz`, SHA256 `3d1399d3bd487594214a774164df3d612da81cb977e056e2a99ea50db6190b78`, https://files.pythonhosted.org/packages/dd/8a/b8a913e4f23bf9481f40a9dc9d44610754d278271e73cff7ac039c6f0634/papers_dl-0.0.25.tar.gz . MIT license included. Python source files remain unchanged on disk.
- `upstream/archivebox-hook.py`: canonical abx-plugins revision `477ccfe842deaa395fd71118115a85375365da64`, used for DOI/arXiv URL normalization.
- `packages.json`: exact published dependency versions, source URLs and SHA256 hashes. Original wheels/source distributions are packaged under `public/papers-dl/`, retaining their source/license metadata. This includes pdf2doi 1.5.1 (MIT), PyPDF2 2.0.0 (BSD), pdfminer.six 20221105 (MIT), pdftitle 0.11, BeautifulSoup 4.12.3, google 3.0.0 and feedparser 6.0.11. Runtime verifies each package hash before unpacking.
- `pyodide-packages.json`: exact Pyodide 0.29.3 WASM package URLs and SHA256 hashes. cryptography uses the supported Pyodide build 46.0.3 with its cffi/OpenSSL dependencies; it is the real library, not a replacement cryptography implementation.
- Source-distribution assets use `.tgz` filenames while retaining the original
  `.tar.gz` package names and SHA256s in `packages.json`. Their bytes are unchanged.
  HTTP static servers can treat a `.gz` suffix as transport Content-Encoding,
  transparently decompressing it before browser hash verification; `.tgz` keeps
  the archive container intact. Each package is stored once.
- `public/papers-dl/mupdf/`: original Artifex MuPDF 1.28.1 JavaScript/WASM distribution, AGPL-3.0-or-later. The npm dependency is pinned. It replaces the native MuPDF binding at the structured-text I/O boundary, preserving pdf2doi's title algorithm.

## Explicit source adaptations

`python/adapt.py` applies checked, localized changes to ephemeral interpreter files before import. It fails if the expected pinned source is absent. It does not replace modules in `sys.modules`, monkeypatch library methods, or supply fake native libraries.

1. papers-dl's Sci-Hub mirror discovery receives the same recorder session already accepted by its other provider functions. Unused aiohttp imports are removed. `res.url.human_repr()` reads the adapter's final URL string. Provider URLs, dispatch, parsing, mirror selection and upstream identifier behavior remain unchanged, including mirror discovery for explicit arxiv selection. The async session preserves pinned aiohttp 3.9.5's 300-second default total request timeout, including response-body acquisition; the initial browser adapter's 30-second limit truncated the 43 MiB Sphere Encoder 2 paper, which the native CLI successfully downloaded.
2. Python requests uses its real `BaseAdapter` extension point and urllib uses its real `BaseHandler` extension point. pdf2doi's two `requests.get` calls import the configured session adapter explicitly. feedparser's `parse(url)` receives the same real urllib handler through its documented `handlers` argument because it constructs a private opener. This preserves feedparser's request headers and response handling.
3. pdf2doi's MuPDF title function consumes real MuPDF WASM structured-text spans instead of a native `fitz` document. Its `fonts`, `font_tags`, and `headers_para` algorithms remain unchanged; a JS walker groups adjacent characters by font and size. MuPDF build differences can affect layout grouping, so identical title output across every document is not claimed.
4. papers-dl associates the selected PDF with its actual final response URL. Upstream zipped completion-order responses with input-order URLs. All already-started provider requests settle before capture finalization.
5. Native writes/MD5 naming/rename operate only in ephemeral Python memory. pdf2doi metadata mutation is disabled to preserve original PDF bytes. WACZ contains original HTTP exchanges, not renamed PDF copies or generated reports. Filename/title/identifier reports are recomputed when viewed.

All HTTP passes through the shared capture `archive.fetch/read` transport. Replay uses the same request signature against recorded WARC responses only; unavailable responses raise explicit errors. Every interpreter owns a worker, preventing native WASM module symbol collisions between concurrent viewers.

## Interface and boundaries

The hook accepts the captured URL with canonical ArchiveBox normalization, or `PAPERSDL_QUERY` for an upstream DOI, arXiv ID, PMID, publisher URL or direct PDF URL. `PAPERSDL_PROVIDERS` defaults to upstream `all`; every original provider name/custom mirror selector is passed through. Request/byte limits are explicit capture constraints and stop further acquisition rather than reporting completeness.

The browser uses the actual upstream library functions behind its capture/view UI. Terminal stdin/options and persistent filesystem/clipboard/Windows shell integration have no browser UI equivalent. Upstream's numeric PMID enum typo (`PMD` defined, `PMID` referenced) remains a real error. Existing upstream provider restrictions remain; no additional publisher resolver, CAPTCHA solver or substitute metadata provider is invented. External service failure can prevent identifier validation/title inference even when the original PDF was acquired successfully.

`tests/papers-upstream-live.test.ts` exercises actual public DOI/arXiv/PDF inputs, compares against the installed native `papers-dl==0.0.25` CLI, verifies WACZ hashes and original PDF bytes, exports/deletes/offline-reimports, and requires zero live HTTP requests while deriving the report. Passing results are reported separately from this implementation description.
