# Gallery presentation

`GalleryPreview.tsx` loads the unchanged vendored `gallerydl/full.html` markup and CSS directly. Its inline script is source-ported as the compiled `gallery-template.ts` initializer, retaining the responsive grid, captions, image dialog, modifier-click behavior, and download/raw controls. The snapshot thumbnail and stack cover use the original `gallerydl/card.html` markup and inline styles with its first original image.

Canonical source hashes and license are retained in `vendor/archivebox/SHA256SUMS` and `vendor/archivebox/PLUGINS-LICENSE`.

Adaptations for WACZ:

- Native transient gallery-dl messages replace Django `output_files`; original record references replace filesystem paths. Images and downloads use Webrecorder replay URLs. Original byte sizes come from recorded response headers or payloads, never compressed WARC lengths.
- The iframe isolates canonical styles from the snapshot shell. The inline script is removed before loading, the Django icon placeholder is substituted, and the compiled initializer receives the iframe Document. No eval or archived scripts execute.
- View all files opens the existing Responses output. Download/View raw target the first original, matching the canonical output-path actions. Each modal downloads its selected original. Like the existing ResourcePreview, download clicks read the original record into a temporary Blob because Chromium downloads bypass the replay service worker; these blobs are revoked and never persisted.
- Metadata and logs remain internal. Only actionable extraction failures are shown outside the canonical iframe. No corpus counts, implementation descriptions, or source/provenance disclaimers appear in the product.
- Card and full-view derivation share one promise per ArchiveReader. Cards are DOM nodes cloned onto stack covers, avoiding additional Python interpreters for thumbnail iframes. No generated image or metadata payload is persisted.
