import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// models.ts is the only door to saved data, so the storage backend can be
// replaced in one file. These checks fail when other code reaches past it.
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  }))).flat();
}

test('only models.ts touches the database, OPFS, or the legacy entries key', async () => {
  const files = [...await sourceFiles('src'), ...await sourceFiles('entrypoints')];
  const violations: string[] = [];
  for (const file of files) {
    const relative = path.relative('.', file);
    const source = await readFile(file, 'utf8');
    const rules: Array<[RegExp, string[]]> = [
      // The SQLite engine, the schema, and the OPFS file layer are private to models.ts.
      [/from ['"][^'"]*\/(sqlite|schema|opfs)['"]/, ['src/lib/models.ts']],
      [/drizzle-orm|@journeyapps\/wa-sqlite/, ['src/lib/models.ts', 'src/lib/schema.ts', 'src/lib/sqlite.ts']],
      [/navigator\.storage\.getDirectory\(/, ['src/lib/opfs.ts']],
      // The pre-SQLite snapshot array: read once by the migrations, never again.
      [/['"]entries['"]/, ['src/lib/models.ts', 'src/lib/storage_migration.ts']],
    ];
    for (const [pattern, allowed] of rules) {
      if (pattern.test(source) && !allowed.includes(relative)) violations.push(`${relative}: ${pattern}`);
    }
  }
  expect(violations).toEqual([]);
});
