# Webrecorder behaviors

Runs the complete pinned Browsertrix Behaviors 0.15.0 source from vendor/browsertrix-behaviors in the existing isolated capture world. Autofetch, autoplay, autoclick, autoscroll and site-specific behavior selection are all enabled. The original Show More selector and the complete Bluesky, Facebook, Instagram, Telegram, Twitter, TikTok and YouTube implementations are retained. Upstream selects a matching site behavior or generic autoscroll.

The default behavior budget is 30 seconds, configurable with BROWSERTRIX_BEHAVIOR_SECONDS. The hook runner still owns ordering, timeouts, cooperative shutdown and hard termination. Local upstream changes add cancellation to sleeps and remove observers/listeners at shutdown. Autoclick lets site event handlers run but prevents the anchor's native navigation from leaving the capture. Modalcloser handles browser-native dialogs separately.

Autofetch calls the shared recorder API through an isolated-world binding. Compatible captured responses are reused; missing resources are recorded normally. Each request retains its original identity. No plugin manages WARC offsets or ZIP layout. Original behavior logs and outcomes are saved once; the existing activity template reads that evidence for cards and the full view.

The separate infiniscroll hook still runs its own canonical scroll/expansion phase before these upstream behaviors. Site applicability and the configured time budget still apply. Enabling the full corpus is not verification of every site or account state. See vendor/browsertrix-behaviors/NOTICE.md for provenance and local lifecycle adaptations.
