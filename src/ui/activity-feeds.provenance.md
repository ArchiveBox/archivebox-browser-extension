# Activity, feeds, robots and search

These plugins have no canonical full viewer in the pinned ArchiveBox template corpus. Their requested viewers reuse the unmodified document, CSS, output actions, panels and rows from `vendor/archivebox/plugins/parse_rss_urls/full.html`; Robots.txt uses the original `htmltotext/full.html` document with a monospace text body. Only the heading and data renderer change. `vendor/archivebox/PLUGINS-LICENSE` applies.

Infinite Scroll and Browser Behaviors render the original hook resources without generating synthetic steps or timestamps. Feeds use the shared RSS/Atom/JSON Feed parser over original archived responses. Search uses the existing literal case-insensitive text search over archived documents. Robots.txt displays and downloads the original response text. Cards use the same shared preview host and cached view model as each full viewer; no separate report files are persisted.
