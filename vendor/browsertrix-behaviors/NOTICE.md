# Browsertrix Behaviors

Source copied from the installed `browsertrix-behaviors` 0.15.0 package, pinned
in pnpm-lock.yaml. Upstream: https://github.com/webrecorder/browsertrix-behaviors
AGPL-3.0-or-later; the original license accompanies this directory.

The recorder bundles this source, not the package's prebuilt bundle. All upstream
site behaviors and generic discovery, clicking, scrolling and playback remain.
Local changes add cooperative cancellation to upstream sleeps, disconnect
observers/listeners at shutdown, and send Autofetcher requests through the same
recording/reuse API as other plugins. The upstream package remains the pinned
source/dependency reference for query-selector-shadow-dom.

The numbered plugin enables autofetch, autoplay, autoclick, autoscroll and
siteSpecific. It does not replace the upstream Show More selector. Execution
stays in the existing isolated capture world, with its configured time budget
and the hook runner's shutdown grace/hard termination. Browser-native
beforeunload dialogs are dismissed to keep the captured tab in place.
