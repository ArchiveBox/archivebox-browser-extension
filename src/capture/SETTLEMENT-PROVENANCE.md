# Page readiness and capture completion

The numbered settle hook uses Browsertrix's advisory page-readiness semantics, not a claim that every browser connection has closed:

- Browsertrix Crawler **b8c38c4da141e855212d65ac714bfe663d178557**, `src/crawler.ts:2802–2818`: wait 0.5 seconds, call network idle with configured timeout/concurrency, log and continue on timeout.
- Same revision `src/util/argParser.ts:566–577`: default idle timeout 2 seconds and permitted active requests 1. `quietMs=500` is the Puppeteer idle-time default.
- The recorder's `waitForIdle` applies this allowance only to observed browser requests. Durable writes/commits and supplemental fetches are returned separately as diagnostics; a permitted browser request never permits an unflushed database write.
- A stop signal still rejects the wait. Hook-runner timeout, graceful shutdown, hard-kill status, supplementary fetch failures, storage failures and export verification are unchanged.

Final completion remains the existing ArchiveWeb.page recorder boundary:

- ArchiveWeb.page **595664ca4ae2f0073d883c3bea6011d51004e249**, `src/recorder.ts:238–302`: stop behavior/background acquisition, detach, then `_stop` and `flushPending`.
- `src/recorder.ts:2117–2157`: flush buffered payloads and discard payload-less browser requests. A finite snapshot does not wait indefinitely for future messages on a live connection.
- The host awaits `close()`/`drain()` before checking recorder errors and exporting. Its write set includes resource writes and page-metadata writes, including writes created by the upstream flush. IDB/commit failures fail the attempt; they never produce a completed WACZ.

The real Discourse topic `/t/try-out-the-new-sidebar-and-notification-menus/238821` leaves a `POST /message-bus/<id>/poll` XHR open after HTTP 200 response headers. CDP proof is retained at `/tmp/abx-discourse-request-probe.json`. It exposed the old bug: a single sum of browser requests and persistence tasks was required to reach zero within five seconds, making a normal long-poll connection fail an otherwise complete finite capture. There are no site URL exceptions, retries, or enlarged timeouts in the correction. Hook diagnostics preserve active request URLs/types/status and separate pending archive queue counts.

The newer Browsertrix recorder also has its own `awaitPageResources` admission boundary and streaming-body stability tracking (`src/util/recorder.ts:1231–1307`); those Node recorder internals are not transplanted into the AWP recorder. Existing AWP finalization is reused.
