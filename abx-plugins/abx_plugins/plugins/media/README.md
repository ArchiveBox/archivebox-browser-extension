# Browser media inventory

Discovers audio/video sources, poster images, tracks, and Open Graph media references from the final live page. Saves only URLs and acquisition references, never duplicate HTTP bodies. The viewer inspects the saved evidence and archive index without network requests.

Supplementary `archive.fetch` is opt-in and bounded by URL count. It reuses already captured responses; new requests come from the extension and can differ from the page's authenticated response. Blob/data references remain in the inventory but are not fetched. A manifest reference is not proof of a complete HLS/DASH recording. No DRM decryption, stream assembly, transcoding, yt-dlp, or full media downloader parity is claimed. Large direct files can require significant memory; default discovery does not download them.

The canonical `media` plugin is a namespace only. This experimental plugin adds discovery; it does not port an existing canonical media extractor.
