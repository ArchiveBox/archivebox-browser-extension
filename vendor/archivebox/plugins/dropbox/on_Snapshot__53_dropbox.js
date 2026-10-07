#!/usr/bin/env -S abxpkg run --script --deps-from=../chrome/config.json:required_binaries,./config.json:required_binaries node
// /// script
// ///
const path = require("path");
const {
  loadConfig,
  getEnvBool,
  getEnvInt,
  parseArgs,
  emitArchiveResultRecord,
} = require("../base/utils.js");
const {
  connectToPage,
  captureBrowserDownloads,
  resolveChromeLaunchOptions,
} = require("../chrome/chrome_utils.js");
const { saveDownloads } = require("../base/downloads.js");

function sharePath(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["www.dropbox.com", "dropbox.com"].includes(url.host) ||
    url.username ||
    url.password
  )
    return null;
  if (!/^\/(?:scl\/(?:fi|fo)|s|sh)\/[\w-]+\//.test(url.pathname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  // Dropbox canonicalizes ?preview=FILE into a child URL with another secure
  // hash. Compare the shared root and exact relative path, not that hash.
  const modernFolder = parts[0] === "scl" && parts[1] === "fo";
  if (modernFolder || parts[0] === "sh") {
    const root = modernFolder ? `fo:${parts[2]}` : `sh:${parts[1]}`;
    const child = parts.slice(modernFolder ? 4 : 3).map(decodeURIComponent);
    if (url.searchParams.has("preview"))
      child.push(url.searchParams.get("preview"));
    return `${root}/${child.join("/")}`;
  }
  return url.pathname;
}

async function main() {
  const config = loadConfig();
  const { url } = parseArgs();
  if (!getEnvBool("DROPBOX_ENABLED", true))
    return emitArchiveResultRecord("skipped", "DROPBOX_ENABLED=False");
  if (!url) throw new Error("Missing --url");
  const original = sharePath(url);
  if (!original)
    return emitArchiveResultRecord("noresults", "Not a Dropbox share URL");
  if (["dl", "raw"].some((key) => new URL(url).searchParams.get(key) === "1"))
    return emitArchiveResultRecord(
      "noresults",
      "Direct Dropbox downloads are captured by staticfile"
    );
  const timeoutMs = getEnvInt("DROPBOX_TIMEOUT", 120) * 1000;
  const deadline = Date.now() + timeoutMs;
  const snapshotDir = path.resolve(config.SNAP_DIR || ".");
  const { browser, page } = await connectToPage({
    chromeSessionDir: path.join(snapshotDir, "chrome"),
    timeoutMs,
    waitForNavigationComplete: true,
  });
  try {
    if (sharePath(page.url()) !== original)
      throw new Error(
        "Chrome tab is not on the requested Dropbox share (login may be required)"
      );
    const downloads = await captureBrowserDownloads({
      browser,
      page,
      timeoutMs: deadline - Date.now(),
      downloadPath: resolveChromeLaunchOptions(config).CHROME_DOWNLOADS_DIR,
      trigger: async ({ downloadStarted }) => {
        // This action downloads the current share, not any individual child item.
        await page
          .locator(
            '[data-testid="action-bar-download-button"], #fvsdk-mount-point button[aria-label="Download"]'
          )
          .setTimeout(deadline - Date.now())
          .click();
        console.error("Opened Dropbox Download action");
        const continueButton = await Promise.race([
          downloadStarted.then(() => null),
          page.waitForSelector(
            ":is(#folder-preview-modal, #shared-link-download-signup-modal) .dig-Modal-footer button",
            { timeout: deadline - Date.now() }
          ),
        ]);
        if (continueButton) {
          // The dialog animates after it enters the DOM. Wait for a stable,
          // visible control before clicking, including after infiniscroll.
          await page
            .locator(
              ":is(#folder-preview-modal, #shared-link-download-signup-modal) .dig-Modal-footer button"
            )
            .setTimeout(deadline - Date.now())
            .click();
        }
        console.error("Dropbox is preparing the download");
      },
    });
    await saveDownloads(
      path.join(snapshotDir, "dropbox"),
      await page.title(),
      downloads
    );
    emitArchiveResultRecord("succeeded", "dropbox/downloads.json");
  } finally {
    await browser.disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  emitArchiveResultRecord("failed", error.message);
  process.exitCode = 1;
});
