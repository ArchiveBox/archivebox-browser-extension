# ReplayWeb.page component

Original source: replaywebpage npm package 2.5.3, src/replay.ts.
Upstream revision: 38305d70c9155caed8f58c84255fac9397155e27.
Source: https://github.com/webrecorder/replayweb.page/blob/38305d70c9155caed8f58c84255fac9397155e27/src/replay.ts
Original source SHA256: b7970d53b001e980ec355de282cd73fc98c66eca4864de6ec41b36624c1f277a.
Copyright Webrecorder Software. AGPL-3.0-or-later; see LICENSE.

replay.js is this original TypeScript component transpiled with TypeScript 5.9.3, ES2022/ESNext, experimentalDecorators=true, useDefineForClassFields=false. It retains the original Lit component, replay iframe lifecycle, Webrecorder messages, navigation, loading, and authorization handling.

Only integration changes before transpilation:

- Import wrapCss from the local misc.js helper extracted unchanged from upstream src/misc.ts, with TypeScript annotations removed.
- Import the unchanged original logo from its local SVG with Vite ?raw.
- Bind the replay and service-worker message listeners for the component's
  connected lifetime and remove them, loading timers and download highlighting
  on disconnect. Upstream's anonymous firstUpdated listeners retained every
  evicted replay document while switching snapshot outputs.
- Add a sandbox directly to the original iframe template. Extension replay uses
  `allow-same-origin` with archived scripts disabled from the first navigation.
  The HTTP player permits scripts, forms, modals, downloads, popups and
  presentation requests in addition to same-origin access. Upstream's original
  iframe has no sandbox; omitting `allow-presentation` from our HTTP sandbox made
  Google Slides throw while initializing its presentation controls. Wombat's
  existing PresentationRequest override rewrites its URLs through replay.
  Remote presentation playback is not tested or claimed.
The original wr-coll-replay registration is retained. No runtime import of the replaywebpage package is used, so there is exactly one replay component implementation.

No custom replay loader, rewriting engine, or archive storage is implemented here. React sets the original collInfo/url/ts/waczhash properties against the already-mounted wabac service-worker collection.

The CSS helper requires upstream main.scss and its CSS imports. main.css contains the exact compiled CSS strings from npm 2.5.3 dist/index.js webpack modules 495 (Shoelace light theme) then 989 (main.scss), in the same order used by the upstream CSS loader. These were extracted as string literals with the TypeScript parser, without executing the package. Compiled stylesheet SHA256: e208af57993b66b1eafde99e55361a4ed44be3631f1219c9dcc5375e2b49218b. All upstream CSS license comments are preserved.
