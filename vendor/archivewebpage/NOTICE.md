# ArchiveWeb.page

Vendored from https://github.com/webrecorder/archiveweb.page/tree/595664ca4ae2f0073d883c3bea6011d51004e249. Copyright Webrecorder Software and contributors. AGPL-3.0-or-later; see LICENSE.md. TypeScript was transpiled to ES2022. Behavior and PDF script imports use Vite raw imports. Host lifecycle, persistence and UI live outside this directory.

Local changes: WARC export generators propagate errors instead of swallowing them, so interrupted exports cannot be reported as successful captures.

Browsertrix injection, recorder page evaluations and host DOM hooks use one named
CDP isolated world. New-document scripts and bindings are scoped to that world,
including separately attached iframe sessions. Evaluation resolves the current
document's context instead of retaining IDs across navigation. Page globals and
prototypes are not used for plugin execution.

Repeated requests to the same URL/page are retained as revisit records instead of being skipped, preserving distinct exchange headers and timestamps while sharing payload bytes.

Revisit references preserve the original record ID, literal target URI and date, including when the original exchange used POST. The wabac dependency patch retains complete CDX request keys and resolves POST originals through existing CDX prefix ranges, verifying the referenced WARC ID, URI, date and payload digest. It creates no extra index or synthetic request. See the [WARC 1.1 reference fields](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/#warc-refers-to-target-uri).

The loading-finished event awaits fullCommit and propagates its failure so the host can drain commits and report acquisition errors before sealing.

The first page receives its identity before navigation commits, so initial HTTP redirects can be saved and reused. The committed page retains that identity and the bytes already associated with it.

Supplemental-fetch failures are reported to the host, and redirect fallback fetches honor the host abort signal.

The exporter exposes getDataPackageMetadata() before upstream manifest hashing, allowing PluginDownloader to add the optional versioned datapackage.archivebox descriptor without replacing ZIP/WARC/CDX writing. ArchiveBox Snapshot and ArchiveResult records, including output_files, live in index.jsonl and pass through the same addFile hashing stream.

Datapackage resources explicitly declare Frictionless `type: "file"`, avoiding
metadata-type inference from arbitrary plugin JSON keys such as `steps`.

The exporter also exposes addExtraFiles() and shouldExportWARCResource(). The
host writes original generated URN evidence once in plugin ZIP folders through
the same addFile hashing stream and excludes those bytes from WARC. HTTP
exchanges, including downloaded paper PDFs, remain in WARC. ArchiveResult
output_files preserve each generated resource's URI, timestamp,
headers and metadata; equal generated payloads share one ZIP path, and evidence
equal to an HTTP payload references that original exchange instead. Export does
not alter the recoverable acquisition database.

RequestResponseInfo retains original CDP connection, cache and timing fields in each response's WARC-JSON-Metadata. DNS and network viewers derive reports from that metadata without duplicating responses in HAR or DNS report files.
