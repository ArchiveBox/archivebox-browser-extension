# Modal Closer

Ports canonical `abx-plugins/modalcloser/on_Snapshot__15_modalcloser.daemon.bg.js`
(2026-10-04). The full consent/interstitial selector corpus and scroll-lock
cleanup are retained. Bootstrap, Radix/shadcn, Angular Material, Headless UI,
jQuery UI, SweetAlert 1/2 and native HTML dialogs use their DOM dismiss controls,
Escape/backdrop events and visibility suppression. No page-world framework
objects are read or called; all DOM execution stays in the capture isolated world.

Native alert, confirm and prompt dialogs use Chrome's real dialog event/command,
with the canonical 1250ms delay. Beforeunload is dismissed so a behavior's link
click cannot navigate away from the capture. Polling defaults to 500ms. There is
no arbitrary 20-action ceiling; the hook runs until normal background cleanup.
Original actions, selectors, timestamps and dialog outcomes are saved once as
plugin evidence. The runner owns shutdown and hard termination.

Real all-plugin acceptance: `tests/modalcloser-live.test.ts`, using the public
JavaScript-dialog demonstration and the official Bootstrap modal documentation. It does
not inject fixture DOM, simulated dialogs or replacement handlers.
