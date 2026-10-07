# papers-dl in Python/WASM

This plugin runs actual `papers-dl==0.0.25`, `pdf2doi==1.5.1`, and their bundled dependencies. It uses the original arXiv/SciDB/Sci-Hub providers, DOI/ISBN/arXiv parser, PDF text/metadata inference, validation and title search. MuPDF uses the real Artifex WASM engine at the native text-layout boundary. See [source and adaptation details](../../../../vendor/papers-dl/PROVENANCE.md).

`PAPERSDL_QUERY` accepts an explicit upstream DOI, arXiv identifier, PMID, publisher URL or direct PDF URL. Empty uses the captured URL with ArchiveBox's DOI/arXiv normalization. `PAPERSDL_PROVIDERS` defaults to upstream `all`; explicit provider names and mirror selectors retain upstream behavior. Numeric PMID queries encounter the upstream enum bug and fail explicitly.

Acquisition records provider, validation and search responses through the shared recorder. It retains original PDF bytes and does not save report sidecars or mutate PDF metadata. The view reruns the real parser and PDF inference against archived responses in a dedicated Python worker, serves original PDFs through Webrecorder, and cannot fall back to live HTTP. Request/byte limits and external access errors are visible limitations; an acquired PDF does not imply successful metadata inference.

Direct PDF navigation records the original response before Chrome opens its native viewer. Chrome temporarily detaches extension debuggers for that privileged viewer; capture waits for the real tab completion and verifies the PDF document's ready state after reattaching. The DOM hook skips browser-owned viewer markup. Papers and LiteParse derive their output from the same original PDF response.

The full view uses the canonical papersdl PDF iframe template. Its output path is a transient Blob URL of bytes read through Webrecorder, because Chrome's native PDF Download bypasses service workers. The URL is revoked when the view unmounts; it creates no stored PDF copy or data URL.
