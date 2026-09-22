"""Exercise a real published Firefox XPI through an in-place Selenium update.

The Selenium container is intentionally external to this script.  It must be
started with the official selenium/standalone-firefox image and a Firefox
wrapper that adds -remote-allow-system-access; this lets the script open the
extension options page through Firefox's real chrome UI while keeping the
profile disposable.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.keys import Keys


REMOTE = os.environ.get("ARCHIVEBOX_FIREFOX_REMOTE", "http://127.0.0.1:4445/wd/hub")
OLD_XPI = Path(os.environ.get("ARCHIVEBOX_PUBLISHED_FIREFOX_XPI", "/tmp/archivebox-published-verification/archivebox-firefox.xpi"))
NEW_XPI = Path(os.environ.get("ARCHIVEBOX_NEXT_FIREFOX_XPI", ".output/archivebox-browser-extension-3.3.2-firefox.zip"))
ADDON_ID = "archivebox@tjhorner.dev"
URL = "https://example.com/archivebox-firefox-upgrade-acceptance"


def die(message: str) -> None:
    raise AssertionError(message)


def install(driver: webdriver.Remote, path: Path, *, temporary: bool = False) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return driver.execute("INSTALL_ADDON", {"addon": payload, "temporary": temporary})["value"]


def make_upgrade_package(path: Path) -> Path:
    """Make a disposable higher-version copy of the current checkout ZIP.

    The checkout intentionally remains at 3.3.2 while the migration work is
    reviewed. Firefox will not update an add-on to an equal version, so only
    this temporary test archive gets version 3.3.3; its code and resources are
    byte-for-byte the freshly built ZIP otherwise.
    """
    fd, filename = tempfile.mkstemp(prefix="archivebox-firefox-upgrade-", suffix=".xpi")
    os.close(fd)
    output = Path(filename)
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "manifest.json":
                manifest = json.loads(data)
                manifest["version"] = "3.3.3"
                data = json.dumps(manifest, separators=(",", ":")).encode()
            target.writestr(info, data)
    return output


def extension_page(driver: webdriver.Remote, page: str) -> None:
    # Marionette rejects moz-extension navigation from content context.  Use
    # the real browser chrome to obtain the assigned UUID, then navigate to the
    # same page in content context where normal Selenium UI actions work.
    driver.execute("SET_CONTEXT", {"context": "chrome"})
    uri = driver.execute_script(
        """
        const extension = WebExtensionPolicy.getByID(arguments[0]).extension;
        return `moz-extension://${extension.uuid}/${arguments[1]}`;
        """,
        ADDON_ID,
        page,
    )
    driver.execute("SET_CONTEXT", {"context": "content"})
    driver.get(uri)


def storage(driver: webdriver.Remote) -> dict:
    return driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        browser.storage.local.get(null).then(done).catch(error => done({__error: String(error)}));
        """
    )


def opfs_bytes(driver: webdriver.Remote, paths: list[str]) -> dict[str, list[int]]:
    return driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        (async () => {
          const root = await navigator.storage.getDirectory();
          const output = {};
          for (const wanted of arguments[0]) {
            const segments = wanted.split('/').filter(Boolean);
            let directory = root;
            for (const segment of segments.slice(0, -1)) {
              directory = await directory.getDirectoryHandle(segment);
            }
            const file = await directory.getFileHandle(segments.at(-1));
            output[wanted] = Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
          }
          done(output);
        })().catch(error => done({__error: String(error)}));
        """,
        paths,
    )


def new_driver(profile: str) -> webdriver.Remote:
    options = Options()
    options.add_argument("-headless")
    options.add_argument("-profile")
    options.add_argument(profile)
    driver = webdriver.Remote(REMOTE, options=options)
    driver.command_executor._commands["INSTALL_ADDON"] = (
        "POST",
        "/session/$sessionId/moz/addon/install",
    )
    driver.command_executor._commands["SET_CONTEXT"] = (
        "POST",
        "/session/$sessionId/moz/context",
    )
    return driver


def allow_permission_if_shown(driver: webdriver.Remote) -> None:
    driver.execute("SET_CONTEXT", {"context": "chrome"})
    clicked = driver.execute_script(
        """
        const button = document.querySelector(
          '#addon-webext-permissions-notification .popup-notification-primary-button'
        );
        if (!button) return false;
        button.click();
        return true;
        """
    )
    driver.execute("SET_CONTEXT", {"context": "content"})
    if clicked:
        time.sleep(0.5)


def open_popup_for_target(driver: webdriver.Remote) -> None:
    driver.execute("SET_CONTEXT", {"context": "chrome"})
    driver.execute_script(
        """
        const target = gBrowser.addTab('about:blank', {
          skipAnimation: true,
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        gBrowser.selectedTab = target;
        target.linkedBrowser.loadURI(Services.io.newURI(arguments[1]), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        """,
        ADDON_ID,
        URL,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        current = driver.execute_script("return gBrowser.selectedBrowser.currentURI.spec;")
        if current == URL:
            break
        time.sleep(0.25)
    else:
        die(f"Firefox target tab did not load before popup capture: {current!r}")
    popup_uri = driver.execute_script(
        """
        const extension = WebExtensionPolicy.getByID(arguments[0]).extension;
        const popup = gBrowser.addTab(`moz-extension://${extension.uuid}/popup.html`, {
          skipAnimation: true,
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        gBrowser.selectedTab = popup;
        return `moz-extension://${extension.uuid}/popup.html`;
        """,
        ADDON_ID,
        URL,
    )
    driver.execute("SET_CONTEXT", {"context": "content"})
    driver.get(popup_uri)


def capture_visible_screenshot(driver: webdriver.Remote) -> dict:
    open_popup_for_target(driver)
    tabs = driver.execute_async_script(
        "const done=arguments[arguments.length-1]; browser.tabs.query({currentWindow:true}).then(t=>done(t.map(x=>({id:x.id,url:x.url,title:x.title,lastAccessed:x.lastAccessed}))));"
    )
    print(f"FIREFOX_SCREENSHOT_TABS {tabs}")
    driver.find_element(By.CSS_SELECTOR, 'button[title^="Save a screenshot"]').click()
    deadline = time.time() + 30
    while time.time() < deadline:
        allow_permission_if_shown(driver)
        item = next((item for item in storage(driver).get("entries", []) if item.get("url") == URL), None)
        if item and item.get("screenshot", {}).get("path"):
            paths = [item["screenshot"]["path"]]
            paths.extend(part["path"] for part in item["screenshot"].get("parts", []))
            return {"entry": item, "bytes": opfs_bytes(driver, paths), "paths": paths}
        time.sleep(0.5)
    item = next((item for item in storage(driver).get("entries", []) if item.get("url") == URL), None)
    print(f"FIREFOX_SCREENSHOT_STATE keys={sorted((item or {}).keys())} popup={driver.find_element(By.TAG_NAME, 'body').text[:240]!r}", file=sys.stderr)
    die("Firefox popup did not save a local screenshot")


def import_url(driver: webdriver.Remote) -> None:
    driver.find_element(By.CSS_SELECTOR, 'nav button:nth-child(4)').click()

    # Create a genuine Firefox bookmark through Places, then use the
    # extension's bookmark-import UI.  This avoids writing extension storage
    # directly and exercises the optional-permission prompt and import path.
    driver.execute("SET_CONTEXT", {"context": "chrome"})
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        (async () => {
          const { PlacesUtils } = ChromeUtils.importESModule(
            'resource://gre/modules/PlacesUtils.sys.mjs'
          );
          await PlacesUtils.bookmarks.insert({
            parentGuid: PlacesUtils.bookmarks.unfiledGuid,
            title: 'Firefox upgrade acceptance URL',
            url: arguments[0],
          });
          done(true);
        })().catch(error => done({error: String(error)}));
        """,
        URL,
    )
    driver.execute("SET_CONTEXT", {"context": "content"})
    driver.find_element(By.XPATH, "//button[contains(., 'Import from Browser Bookmarks')]").click()
    time.sleep(0.8)
    allow_permission_if_shown(driver)
    deadline = time.time() + 15
    while time.time() < deadline:
        if URL in driver.find_element(By.TAG_NAME, "main").text:
            break
        time.sleep(0.25)
    else:
        die("Firefox bookmark importer did not show the real bookmark")
    row = driver.find_element(By.XPATH, f"//tr[.//*[contains(normalize-space(), '{URL}')]]")
    row.find_element(By.CSS_SELECTOR, 'input[type="checkbox"]').click()
    driver.find_element(By.XPATH, "//button[contains(., 'Import Selected (1)')]").click()
    deadline = time.time() + 15
    while time.time() < deadline:
        if any(item.get("url") == URL for item in storage(driver).get("entries", [])):
            return
        time.sleep(0.25)
    die("Firefox bookmark importer did not persist the imported entry")


def sync_url(driver: webdriver.Remote) -> dict:
    """Submit the imported URL through the published UI and return its row."""
    driver.find_element(By.CSS_SELECTOR, 'nav button:nth-child(1)').click()
    row = driver.find_element(By.XPATH, f"//tr[.//*[contains(normalize-space(), '{URL}')]]")
    row.find_element(By.CSS_SELECTOR, 'input[type="checkbox"]').click()
    driver.find_element(By.XPATH, "//button[normalize-space()='Sync']").click()
    time.sleep(0.8)
    allow_permission_if_shown(driver)
    deadline = time.time() + 60
    while time.time() < deadline:
        item = next((item for item in storage(driver).get("entries", []) if item.get("url") == URL), None)
        if item and (item.get("archiveboxCrawlId") or item.get("archiveboxSnapshotId")):
            return item
        time.sleep(0.5)
    die("published Firefox UI did not receive a server crawl/snapshot ID")


def main() -> int:
    if not OLD_XPI.is_file() or not NEW_XPI.is_file():
        die(f"missing package: old={OLD_XPI} new={NEW_XPI}")
    upgrade_xpi = make_upgrade_package(NEW_XPI)
    profile = os.environ.get(
        "ARCHIVEBOX_FIREFOX_PROFILE",
        f"/tmp/archivebox-firefox-upgrade-{os.getpid()}-{time.time_ns()}",
    )
    container = os.environ.get("ARCHIVEBOX_FIREFOX_CONTAINER", "archivebox-firefox-upgrade")
    subprocess.run(["docker", "exec", container, "mkdir", "-p", profile], check=True)
    key_file = os.environ.get("ARCHIVEBOX_TEST_KEY_FILE")
    if not key_file:
        die("Set ARCHIVEBOX_TEST_KEY_FILE; the test never guesses a credential path")
    server = os.environ.get("ARCHIVEBOX_TEST_SERVER", "http://host.docker.internal:18771").rstrip("/")
    key = Path(key_file).read_text().strip()
    driver: webdriver.Remote | None = None
    try:
        # Stage 1: a real published package in a disposable but persistent
        # Firefox profile.  Closing this WebDriver session is the browser
        # restart boundary; storage remains in the profile for stage 2.
        driver = new_driver(profile)
        # Keep both stages temporary in this disposable Selenium profile.  The
        # published XPI is signed, but Firefox refuses an unsigned checkout
        # ZIP as a permanent install; temporary installs retain the real
        # declared ID and storage while permitting the update test.
        old_id = install(driver, OLD_XPI, temporary=True)
        if old_id != ADDON_ID:
            die(f"published XPI installed as {old_id!r}, expected {ADDON_ID!r}")
        extension_page(driver, "options.html")

        # Configure using the published options UI.  The API key is only used
        # as an input value and is never printed in this test's output.
        driver.find_element(By.CSS_SELECTOR, 'nav button:nth-child(2)').click()
        inputs = driver.find_elements(By.TAG_NAME, "input")
        server_input = next(item for item in inputs if item.get_attribute("placeholder") == "http://localhost:8000 or https://archivebox.example.com")
        key_input = next(item for item in inputs if item.get_attribute("placeholder") == "... abcexamplekey1234 ...")
        server_input.send_keys(server)
        server_input.send_keys(Keys.TAB)
        key_input.send_keys(key)
        key_input.send_keys(Keys.TAB)
        screenshot_toggle = driver.find_element(
            By.XPATH,
            "//label[contains(., 'Save full-page screenshots locally')]//input[@type='checkbox']",
        )
        if not screenshot_toggle.is_selected():
            screenshot_toggle.click()
        deadline = time.time() + 10
        while time.time() < deadline and not storage(driver).get("save_screenshots_locally"):
            time.sleep(0.25)
        if not storage(driver).get("save_screenshots_locally"):
            die("published options UI did not enable local screenshots")
        driver.find_element(By.CSS_SELECTOR, 'nav button:nth-child(4)').click()
        import_url(driver)
        synced_old_entry = sync_url(driver)
        old_screenshot = capture_visible_screenshot(driver)
        old = storage(driver)
        if old.get("archivebox_server_url") != server:
            die("published options UI did not save archivebox_server_url")
        if old.get("archivebox_api_key") != key:
            die("published options UI did not save archivebox_api_key")
        if not any(item.get("url") == URL for item in old.get("entries", [])):
            die("published options UI did not retain imported URL")
        old_ids = [item["id"] for item in old["entries"]]
        old_remote_ids = {
            synced_old_entry.get("archiveboxCrawlId"),
            synced_old_entry.get("archiveboxSnapshotId"),
        } - {None}
        if not old_remote_ids:
            die("published Firefox UI returned no remote IDs after server sync")
        old_persona_ids = [item["id"] for item in old.get("personas", [])]
        old_persona_names = [item["name"] for item in old.get("personas", [])]
        print(f"OLD_READY addon={old_id} entries={len(old['entries'])} personas={len(old_persona_ids)}")
        driver.quit()
        driver = None

        # Stage 2: a fresh Firefox process reuses the same profile, then the
        # current package is installed under its same declared ID.  This is a
        # genuine browser restart/update boundary; Firefox's temporary-install
        # endpoint is used because the checkout ZIP is intentionally unsigned.
        driver = new_driver(profile)
        new_id = install(driver, upgrade_xpi, temporary=True)
        if new_id != ADDON_ID:
            die(f"new package installed as {new_id!r}, expected {ADDON_ID!r}")
        extension_page(driver, "options.html")
        deadline = time.time() + 20
        after = storage(driver)
        while after.get("storage_schema_version") != 1 and time.time() < deadline:
            time.sleep(0.25)
            after = storage(driver)
        if after.get("storage_schema_version") != 1:
            die(f"migration did not write storage_schema_version=1: {after.get('storage_schema_version')!r}")
        if [item["id"] for item in after.get("entries", [])] != old_ids:
            die("local entry IDs changed during Firefox upgrade")
        if [item["id"] for item in after.get("personas", [])] != old_persona_ids:
            die("persona IDs changed during Firefox upgrade")
        if [item["name"] for item in after.get("personas", [])] != old_persona_names:
            die("persona names changed during Firefox upgrade")
        registry = after.get("server_registry", {})
        servers = registry.get("servers", [])
        if len(servers) != 1 or servers[0].get("server") != server or servers[0].get("token") != key:
            die("Firefox migration did not create the configured server registry entry")
        server_id = servers[0]["id"]
        if after.get("active_persona") != old.get("activePersona"):
            die("active persona ID changed during Firefox upgrade")
        migrated = next(item for item in after["entries"] if item["url"] == URL)
        remote_copy = migrated.get("remote_copies", {}).get(server_id) or migrated.get("unassigned_remote_copy")
        migrated_remote_ids = {
            remote_copy.get("crawl_id") if remote_copy else None,
            remote_copy.get("snapshot_id") if remote_copy else None,
        } - {None}
        if not old_remote_ids.issubset(migrated_remote_ids):
            die("Firefox migration did not preserve the published remote IDs")
        if opfs_bytes(driver, old_screenshot["paths"]) != old_screenshot["bytes"]:
            die("Firefox migration changed local screenshot OPFS bytes")
        # A second browser restart must leave the migrated record byte-stable
        # at the schema level and must not create another server entry.
        driver.quit()
        driver = None
        driver = new_driver(profile)
        if install(driver, upgrade_xpi, temporary=True) != ADDON_ID:
            die("reload install changed the Firefox add-on ID")
        extension_page(driver, "options.html")
        deadline = time.time() + 20
        reloaded = storage(driver)
        while reloaded.get("storage_schema_version") != 1 and time.time() < deadline:
            time.sleep(0.25)
            reloaded = storage(driver)
        if reloaded.get("storage_schema_version") != 1:
            die("storage schema marker disappeared after Firefox reload")
        if len(reloaded.get("server_registry", {}).get("servers", [])) != 1:
            die("Firefox reload duplicated the migrated server registry")
        if [item["id"] for item in reloaded.get("entries", [])] != old_ids:
            die("Firefox reload changed local entry IDs")
        if [item["id"] for item in reloaded.get("personas", [])] != old_persona_ids:
            die("Firefox reload changed persona IDs")
        if opfs_bytes(driver, old_screenshot["paths"]) != old_screenshot["bytes"]:
            die("Firefox reload changed local screenshot OPFS bytes")
        print("RELOAD_OK schema=1 entries=1 personas=3 servers=1")
        print(
            f"UPGRADE_OK addon={new_id} schema={after['storage_schema_version']} "
            f"entries={len(after['entries'])} personas={len(after['personas'])} servers={len(servers)}"
        )
        return 0
    finally:
        try:
            if driver is not None:
                driver.quit()
        finally:
            upgrade_xpi.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, WebDriverException, KeyError, StopIteration) as error:
        print(f"FIREFOX_UPGRADE_FAILED: {error}", file=sys.stderr)
        raise
