# Browser cookie rejection

Opt-in early background behavior for explicit reject/deny buttons from OneTrust, Cookiebot, CookieYes, Complianz and Osano. This changes the live page's consent state and may set a rejection cookie. It never clicks accept/agree controls. Statistics are attempted clicks, not validated consent state.

The canonical plugin installs I Still Don't Care About Cookies from Chrome Web Store; its hook only monitors that extension. This implementation neither installs nor embeds that extension or its full rule corpus. It is a small independent behavior subset, not equivalent coverage. Native dialogs, shadow-root controls and cross-origin frames are not covered.
