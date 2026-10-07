# Forum threads

Runs the complete bundled upstream [forum-dl corpus](../../../../vendor/forum-dl/NOTICE.md) in Pyodide, using Requests' transport extension point to acquire original responses through the shared recorder. Browser credentials accompany requests. All upstream detections, forum/mailing-list parsing, pagination, reply structure and File traversal remain Python upstream code.

The hook saves only original-response references and diagnostics. Opening the forum reader runs that same engine against WACZ originals with no live network fallback. Thread/post/file metadata remains a transient derivation. Request and byte budgets report partial capture; upstream parser failures remain visible. Eleven bundled families means code coverage, not a claim that every live deployment or authentication scheme has passed browser acceptance.

The reader uses ArchiveBox's existing forumdl full and card templates. Its compiled initializer receives native model records, resolves images from the WACZ, and supplies the existing Download and View raw actions with transient JSONL. No derived report is stored in the WACZ.
