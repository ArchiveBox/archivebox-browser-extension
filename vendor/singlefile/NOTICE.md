# SingleFile

The browser plugin imports `single-file-core` 1.6.24, pinned with its package
integrity in pnpm-lock.yaml, from https://github.com/gildas-lormeau/single-file-core.
Copyright Gildas Lormeau, AGPL-3.0-or-later. Upstream license notices are retained
in the bundled source. See patches/README.md for the extension URL adaptation.

The supported getPageData(options, initOptions, document, window) API runs over
a disposable, script-disabled iframe containing the DOM derived from replay.
SingleFile handles asset inlining, CSS/fonts, duplicate image grouping, form
state and HTML compression. Its fetch adapter only reads Webrecorder's local
replay URLs. Capture-time behaviors have already run; deferred live-page actions
and frame discovery are not rerun against the original site. Frame/shadow/canvas
state absent from the original DOM evidence cannot be recreated by this viewer.

The result is shared by the full view and downloadable singlefile.html. Cards
preview the captured DOM through replay and never start the SingleFile engine.
The file embeds assets as required by SingleFile's format. Other viewers retain
normal WACZ replay URLs. Generated HTML and its inline asset copies are never
written back to the WACZ. Navigation links are restored to original URLs for the
standalone download; its display assets do not require the player or the network.
