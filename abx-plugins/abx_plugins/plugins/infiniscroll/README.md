# Browser scrolling

Ports the canonical plugin's bounded scrolling and `<details>` expansion into the live captured page. Defaults to at most five seconds and ten steps, restores the original viewport position, and observes Worker cancellation between page operations. Newly requested bytes belong to the shared network archive; only interaction statistics are added separately.

Does not click arbitrary "show more" buttons, follow links, scroll every nested container, or promise complete feeds. Expanding virtualized feeds can leave only the final visible items in the DOM; earlier responses remain in the WACZ. Long interactions are opt-in through the timeout/step settings (hard maximum 30 seconds). The default suite follows this bounded phase with the separate Browsertrix behavior pass.
