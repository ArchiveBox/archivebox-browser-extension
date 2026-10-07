# Canonical plugin documents

`CanonicalDataPreview` hosts each plugin's unchanged vendored `full.html`, removing only its inline script and substituting the plugin icon. Each view imports its own template and a compiled source port of that template's original script. There is no runtime evaluation of template scripts and no parallel generic-table layout.

The DNS, headers, and redirects ports are `dns-template.js`, `headers-template.js`, and `redirects-template.js`. Their DOM creation, classes, CSS, labels, copy actions, and responsive layout come directly from `vendor/archivebox/plugins/<plugin>/full.html`. The corresponding `browser/view.ts` adapts original WACZ response headers, request pairs, network evidence, and recorded redirects to the canonical data fields. DNS uses the same host/IP deduplication as the canonical CDP hook. Resolver addresses and navigation causes that were not captured are not invented.

The host replaces source-file fetches with transient data passed to the initializer. Output controls open the plugin's preserved files or download/view the transient native-shaped data. Resource lookup resolves only original WACZ records. Temporary Blob URLs are revoked when the view unmounts; no derived data is written back into the archive.

Vendored source hashes and licenses remain in `vendor/archivebox/SHA256SUMS` and `vendor/archivebox/PLUGINS-LICENSE`.
