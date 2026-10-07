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

function folderId(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.host !== "drive.google.com" ||
    url.username ||
    url.password
  )
    return null;
  const id =
    url.pathname.match(
      /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)(?:\/|$)/
    )?.[1] ||
    (url.pathname === "/folderview" ? url.searchParams.get("id") : null);
  return id && /^[\w-]+$/.test(id) ? id : null;
}

async function main() {
  const config = loadConfig();
  const { url } = parseArgs();
  if (!getEnvBool("GDRIVE_ENABLED", true))
    return emitArchiveResultRecord("skipped", "GDRIVE_ENABLED=False");
  if (!url) throw new Error("Missing --url");
  const id = folderId(url);
  if (!id)
    return emitArchiveResultRecord(
      "noresults",
      "Not a Google Drive folder URL"
    );
  const timeoutMs = getEnvInt("GDRIVE_TIMEOUT", 120) * 1000;
  const deadline = Date.now() + timeoutMs;
  const snapshotDir = path.resolve(config.SNAP_DIR || ".");
  const { browser, page } = await connectToPage({
    chromeSessionDir: path.join(snapshotDir, "chrome"),
    timeoutMs,
    waitForNavigationComplete: true,
  });
  try {
    if (folderId(page.url()) !== id)
      throw new Error(
        "Chrome tab is not on the requested Drive folder (login may be required)"
      );
    const downloads = await captureBrowserDownloads({
      browser,
      page,
      timeoutMs: deadline - Date.now(),
      downloadPath: resolveChromeLaunchOptions(config).CHROME_DOWNLOADS_DIR,
      trigger: async () => {
        // The signed-in breadcrumb downloads the folder itself, including nesting.
        // Anonymous Drive exposes only its built-in Select all + Download action.
        const folderButton =
          '[guidedhelpid="folder_path_button"] [role="button"]';
        await page.waitForSelector(
          `${folderButton}, [data-id="${id}"][role="link"]`,
          { timeout: deadline - Date.now() }
        );
        const breadcrumb = await page.$(folderButton);
        console.error(
          breadcrumb
            ? "Opening Drive folder menu"
            : "Selecting folder contents in Drive"
        );
        if (breadcrumb) await breadcrumb.click();
        else {
          const first = await page.waitForSelector('[role="row"][data-id]', {
            timeout: deadline - Date.now(),
          });
          await first.click();
          const modifier = await page.evaluate(() =>
            /Mac/.test(navigator.platform) ? "Meta" : "Control"
          );
          await page.keyboard.down(modifier);
          await page.keyboard.press("KeyA");
          await page.keyboard.up(modifier);
          await first.click({ button: "right" });
        }
        console.error("Opening Drive Download action");
        await page
          .locator('::-p-aria([name="Download"][role="menuitem"])')
          .setTimeout(deadline - Date.now())
          .click();
        console.error("Drive is preparing the folder ZIP");
        // Wait for ZIP preparation to finish before closing the download batch.
        await page.waitForSelector('[aria-label="Cancel download"]', {
          timeout: deadline - Date.now(),
        });
        await page.waitForFunction(
          () =>
            ![
              ...document.querySelectorAll('[aria-label="Cancel download"]'),
            ].some((el) => el.getClientRects().length),
          { timeout: deadline - Date.now() }
        );
      },
    });
    await saveDownloads(
      path.join(snapshotDir, "gdrive"),
      await page.title(),
      downloads,
      { requireZip: true }
    );
    emitArchiveResultRecord("succeeded", "gdrive/downloads.json");
  } finally {
    await browser.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  emitArchiveResultRecord("failed", error.message);
  process.exitCode = 1;
});
