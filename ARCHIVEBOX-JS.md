# ArchiveBox JS integration

Capture, replay, plugin, WASM/Python asset, and viewer sources were imported from
https://github.com/ArchiveBox/archivebox-js/tree/6accc97adad02ce784bcb10ec6a6aedfef6d9d7d.
They are built directly by this extension with WXT. There is no second extension or runtime service.
Upstream notices and source patches remain in `vendor/` and `patches/`.
The combined extension is AGPL-3.0-or-later; the original extension's MIT license is retained in `LICENSES/`.

All registered plugins participate in every capture. A finished WACZ is verified before it is published in the existing saved-URL catalog. Interrupted attempts cannot be exported or resumed; capture the URL again. Existing standalone screenshots, MHTML, and HTML remain readable.

The toolbar, context menu, keyboard shortcut, and automatic archiving open the same
capture page. That page owns the full engine while the popup can close. The existing
Snapshot UUID identifies its hook results, OPFS directory, and replay collection:
`snapshots/YYYYMMDD/hostname/UUID/archivebox_js/capture.wacz`.
There is one catalog (`entries` in extension storage); `Snapshot.wacz` holds progress
and the verified file reference. Temporary acquisition uses the upstream IndexedDB
recorder. OPFS contains the final artifact; replay indexes and derived caches can be
discarded. Deletion removes those together.

Integration changes live in `src/capture/background.ts`, `src/archive/storage.ts`,
`entrypoints/studio/`, and the existing popup/options/background entrypoints. Engine
changes enforce whole-attempt completion, preserve the catalog's Snapshot identity,
and discard interrupted attempts. Replay accepts the extension's compact UUIDs and
reads its existing OPFS hierarchy. The original source notices may refer to tests and
evidence in archivebox-js; this extension's acceptance suite is
`tests/wacz-capture.test.ts` plus the native popup tests.

All 48 plugins are selected, including 27 acquisition/processing hooks; derived-only
plugins run when their views are opened. Hook outcomes retain diagnostics and may
include failed or inapplicable plugins. A recorder failure, interruption, or invalid
export fails the entire attempt. There is no partial WACZ export or recovery UI.

Full acquisition currently requires Chrome/Edge's debugger API. Firefox/Safari retain
URL, server, and persona features. Server submission remains separate from local
archiving: existing URL receipts never authorize deleting a WACZ. Upload/import of
the completed WACZ is a subsequent server integration.
