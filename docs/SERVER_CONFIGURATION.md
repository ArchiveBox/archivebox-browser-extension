# Server configuration contract

The Apple app, Android app, and browser extension implement this contract independently. Keep this document and `server_registry.example.json` identical in all three repositories. There is no shared runtime library. The unreleased Apple and Android apps adopt this schema directly. The published Chrome and Firefox extension requires the one-time upgrade described below.

## Stored configuration

Store one `server_registry` object with `schema_version`, `servers`, `active_server_id`, and `default_server_ids`. A server has `id`, `name`, `server`, `token`, and `persona`. See the adjacent example. Null selections are explicit JSON null; empty collections are arrays, not null. Reject unsupported schema versions, duplicate IDs, and dangling or duplicate selection IDs.

`id` is a lowercase, hyphenated UUID generated once when creating a profile. It identifies a locally configured destination, not a server's installation. Renaming a profile, rotating its token, changing its persona, or choosing it for browsing does not change its ID. Changing the configured endpoint selects or creates another profile and retains the previous one. Do not hash URLs or credentials to generate identities. Safari reads the same IDs from the native app.

`server` and `token` retain the existing connection terminology. `persona` is the server's persona name, matching the add API; null means the named `Default` persona. Persona IDs returned by a server are local to that server. Selecting a default persona does not grant cookie-upload consent.

`active_server_id` chooses the collection to browse. `default_server_ids` chooses destinations for new shares and automatic submissions. They are independent. Registry updates preserve both unless the caller explicitly changes the selection. Existing connection setup screens select the newly configured destination for both; browsing selectors added later must change only `active_server_id`.

Apple stores the object in device-only shared Keychain. Android encrypts it with its device Keystore key. The extension stores it in local browser storage; Safari reads the native registry until the user explicitly saves an extension-owned connection. Browser-specific `server_policies` stay separate, keyed by server ID (`local_persona_id`, `upload_screenshots_to_server`, `upload_mhtml_to_server`, `upload_singlefile_to_server`). Local capture and UI preferences remain global.

## Operations and state

Resolve and capture a server configuration before starting work. Pass it explicitly through API calls, cookie sync, uploads, tag edits, and removal. Do not reread a mutable active/default destination halfway through a request. A submission receipt is `{server_id, crawl_id, queued_urls}`. Keep server API names unchanged instead of translating between camelCase and snake_case. Functions and methods retain camelCase names; data fields and state values use snake_case. Platform-owned API identifiers retain their required spelling.

Native share receipts remain in memory. Recent tags and submission state belong to `server_id`. The extension keeps one local snapshot `id` and `remote_copies[server_id]` containing the server-returned `crawl_id` and `snapshot_id`, `submitted_at`, `submitted_to`, `persona`, and `status`. Never use a local snapshot ID as an implicit remote ID. `accepted` means the crawl is persisted; `complete` means metadata and requested local uploads finished, not that the server finished archiving. Failed or interrupted uploads leave the copy accepted and ineligible for local retention cleanup.

Tag edits/uploads target the selected copy's remote snapshot ID. Removal targets its recorded crawl, matching native share removal. Remove only that server's local receipt after confirmed deletion. Cookie consent and remote persona references are scoped by both server and local persona IDs. Retention requires every recorded remote copy to be complete and verifies each exact remote ID+URL against its server before deleting local bytes.

## Published browser extension upgrade

Before reading or writing current state, the extension migrates published storage under a cross-context lock. A single local storage write publishes the registry, snapshot copies, persona references, cookie-sync bindings, and `storage_schema_version: 1` together. Subsequent loads use only the current schema. The old singleton server/key (including the older synchronized server URL), selected local persona, and upload preferences become one profile and its policy. Global preferences, local snapshot IDs, capture paths/bytes, persona cookies, and settings stay intact.

Only an explicit matching submission destination associates old remote IDs with a profile. Unattributed history is retained as `unassigned_remote_copy` and prevents automatic local cleanup. Published submission timestamps do not prove that uploads finished, so migrated receipts begin as `accepted`; a successful new sync establishes `complete`. No local ID is promoted to a server ID. Existing cookie-sync consent transfers only to the same server origin and local persona; changing a destination never grants consent. Unmatched legacy connection/consent data remains available for recovery and is not used for requests.

The extension also retains the published legacy `/add/` protocol. Its browser-only `LegacySubmissionReceipt` has `legacy: true` and a nullable `crawl_id`: HTML confirmation cannot manufacture a server ID. These copies remain `accepted`, and local cleanup cannot treat them as complete. Native API receipts remain strict. Creating a new local capture invalidates completion for every copy whose upload policy requests that capture; failed uploads retain local bytes.

## Next version

The registry and explicit operation boundaries are groundwork. Current interfaces still use one destination at a time (the first submission default); multi-server selectors, fan-out, badges, and independent per-server progress are not implemented yet. Keep immediate submission on opening Share/the popup. Each future badge should save to its server or issue a best-effort deletion when tapped; do not add cancellation or rollback orchestration.

Before enabling fast collection switching, scope webview ownership, cookies, search results, navigation history, Spotlight/entity references, and asynchronous UI updates to the selected server ID. Android's shared WebView cookie store requires explicit session teardown on switching. Add two-server UI tests when introducing those selectors.

Release the native Safari bridge and the matching extension together. The bridge request is `{action: "get_server_registry", schema_version: 1}` and response is `{server_registry: ...}`. Update the Apple packaging revision to the committed extension revision before release; use `ARCHIVEBOX_EXTENSION_SOURCE` for local development builds.
