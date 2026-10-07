# Local upstream source corrections

The pinned `upstream/` tree and its SHA-256 manifest remain unchanged. `build-runtime.py` copies it into a temporary build directory, applies the reviewed unified diff, then builds the runtime wheel. This is patched upstream Python, not replacement parsers or runtime monkeypatches.

`0001-preserve-hn-discourse-traversal.patch` carries four narrow corrections previously present in the retired browser translations:

- Hacker News feed items must be cached for subsequent upstream Writer post traversal. Without `should_cache=True`, the real jobs feed enumerates 31 Threads, then yields zero Posts and logs `AlreadyVisitedError` for every item.
- Hacker News history pages need separate lists rather than aliasing every page to one list.
- Discourse nested category lookup must inspect each parent's children. The pinned code checks the root dictionary twice and raises `ValueError` on the real Meta sidebar topic in nested category 67 under 207.
- Discourse pagination consumes returned IDs for its first response and requested IDs for later batches. Consuming one stream entry per returned post repeats or loses work when deleted/inaccessible IDs occur.

Native/browser acceptance uses the same built wheel. The unpatched HN jobs and Meta Discourse acceptance tests were first run and failed at the native completeness assertion (real HTTP and real upstream models). Their retained red evidence is under `/tmp/abx-forum-regression-red-20261004` for this development run; that location is not a packaged artifact.

`0002-parse-hypermail-date.patch` routes Hypermail's legacy Date meta strings through the already-bundled dateparser library, like the other upstream mailing-list extractors. The unchanged fixture previously failed with Pydantic `invalid datetime format` and zero posts. The real red test is retained under `/tmp/abx-forum-hypermail-red-20261004`; the patched native run returns all 15 posts with dates.
