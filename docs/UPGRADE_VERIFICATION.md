# Published extension upgrade verification

The multi-server groundwork upgrades the published Chrome and Firefox **3.3.2** storage format. The native apps adopt the new schema directly. See [SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md) for the common contract and the extension-only migration boundary.

The published packages inspected on 2026-09-20 were:

| Store | Package | SHA-256 |
| --- | --- | --- |
| [Chrome](https://chromewebstore.google.com/detail/archivebox-exporter/habonpimjphpdnmcfkaockjnffodikoj) | CRX3, `habonpimjphpdnmcfkaockjnffodikoj`, 3.3.2 | `e8af2f6ddee9fc7fbcd799237dfb78523257c20358eb24521e8373d2af58157d` |
| [Firefox](https://addons.mozilla.org/en-US/firefox/addon/archivebox-exporter/) | [XPI file 5035763](https://addons.mozilla.org/firefox/downloads/file/5035763/archivebox_exporter-3.3.2.xpi), `archivebox@tjhorner.dev`, 3.3.2 | `5cdfc09ac43731859a97d8fac1fbac715041c3415d194ba04df818229522bdee` |

Both packages use the same singleton connection, snapshot, persona, and cookie-sync field names. The published snapshot format has remote IDs but no submission destination. Such IDs are retained as unassigned history; migrating them must not authorize requests to a guessed server. Global capture settings and local artifact paths are unchanged.

## Real-browser checks

Build with `pnpm compile && pnpm build`. Run the following against disposable real collections; the scripts create disposable browser profiles and use actual extension interfaces, storage, captures, and API responses. API-key files must contain test credentials, not production credentials.

```sh
export ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:18771
export ARCHIVEBOX_TEST_KEY_FILE=/path/to/first-test-api-key
export ARCHIVEBOX_TEST_SECOND_SERVER=http://127.0.0.1:18772
export ARCHIVEBOX_TEST_SECOND_KEY_FILE=/path/to/second-test-api-key

# First collection needs Personal and Work personas; second needs Work.
node scripts/test-multiserver-live.mjs
node scripts/test-retention-live.mjs

# Extract the actual store CRX ZIP payload without changing application code.
export ARCHIVEBOX_PUBLISHED_EXTENSION=/path/to/extracted-chrome-3.3.2
export ARCHIVEBOX_PUBLISHED_CRX=/path/to/published-chrome-3.3.2.crx
node scripts/test-upgrade-live.mjs

# Real ArchiveBox 0.7.4 collection, with PUBLIC_ADD_VIEW enabled.
export ARCHIVEBOX_TEST_LEGACY_SERVER=http://127.0.0.1:18773
export ARCHIVEBOX_TEST_LEGACY_CONTAINER=archivebox-multiserver-legacy
node scripts/test-legacy-live.mjs
```

The Chrome upgrade test extracts the store identity from the CRX signing key, loads the published application, configures it through its UI, imports a bookmark and a real server cookie, manually syncs the selected persona, and captures a screenshot. It then replaces the application under the same extension ID and verifies migrated settings, consent, local/remote IDs, and byte-identical OPFS files through a second reload. Permissions declared by the extension are pregranted in this disposable test installation.

The two-server test verifies independent server-assigned IDs/personas, capture uploads to both collections, isolated deletion, token-edit identity stability, and retention across actual clock deadlines. A failed new capture upload must remain pending and retain its local bytes. The legacy test verifies real `/add/` HTML acceptance without fabricated IDs and no duplicate submission after reopening.

Local checks complement the existing CI packaging, import/layout tests, screenshot capture, and website cascades. They do not replace store publication or native device acceptance.
