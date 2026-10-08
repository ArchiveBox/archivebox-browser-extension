import { test } from './helpers/archivebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Exercise the same documented commands against a disposable real API in CI.
// These scripts use browser controls, actual captures, and elapsed wall time.
for (const [name, script] of [
  ['automatic capture rechecks exclusions before upload', 'test-auto-archive-live.mjs'],
  ['file delivery receipts survive refresh and real upload failures', 'test-sync-status-live.mjs'],
  ['per-type retention preserves unuploaded files and expires on the recurring alarm', 'test-retention-live.mjs'],
] as const) {
  test(name, async ({ archivebox }) => {
    test.setTimeout(240_000);
    await promisify(execFile)(process.execPath, [path.resolve('scripts', script)], {
      env: { ...process.env, ARCHIVEBOX_TEST_SERVER: archivebox.server, ARCHIVEBOX_TEST_KEY_FILE: archivebox.keyFile },
      maxBuffer: 1_000_000,
    });
  });
}
