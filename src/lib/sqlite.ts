// Private to models.ts: nothing else may open the database (see models.ts).
import SQLiteAsyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from '@journeyapps/wa-sqlite';
import * as IDBBatchAtomic from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { drizzle, type AsyncRemoteCallback, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

// The package's bundled .d.ts describes an older, removed version of this class.
const { IDBBatchAtomicVFS } = IDBBatchAtomic as unknown as {
  IDBBatchAtomicVFS: { create(name: string, module: unknown): Promise<SQLiteVFS & { close(): void }> };
};

// SQLite (wa-sqlite, PowerSync's maintained fork) with its pages stored in
// IndexedDB through IDBBatchAtomicVFS.
// WHY this engine: IndexedDB is the one durable store present in every
// extension context on every browser, including Chrome's MV3 service worker
// (which cannot start the dedicated Worker that OPFS-backed SQLite needs) and
// Safari on iOS. SQLite reads pages on demand, so 1M+ snapshots never load
// into memory at once. The popup, options page and background each open their
// own connection; the VFS serializes writers across them with Web Locks and
// SQLite re-validates its page cache whenever it takes the lock, so no single
// "owner" process is needed.
// WHY the async build: IndexedDB is asynchronous, so the VFS needs Asyncify.

export type SqlValue = string | number | null | Uint8Array;
export type Orm<TSchema extends Record<string, unknown>> = SqliteRemoteDatabase<TSchema>;

export type Database<TSchema extends Record<string, unknown>> = {
  // Drizzle over this connection; each query runs on its own.
  orm: Orm<TSchema>;
  // Runs fn inside BEGIN IMMEDIATE ... COMMIT, with this connection held for
  // the whole transaction. fn must query only through the Drizzle instance it
  // is given: anything through `orm` waits until the transaction ends.
  transaction<T>(fn: (tx: Orm<TSchema>) => Promise<T>): Promise<T>;
  // Applies the migration scripts not yet run, in order, in one transaction.
  // PRAGMA user_version counts how many have run.
  migrate(scripts: string[]): Promise<void>;
};

const databaseName = 'archivebox';
// Prepared statements kept per connection. Bulk writes run the same few
// statements hundreds of thousands of times; re-preparing each dominated.
const statementCacheSize = 100;

async function openConnection<TSchema extends Record<string, unknown>>(schema: TSchema): Promise<Database<TSchema>> {
  const module = await SQLiteAsyncFactory({
    // Copied into assets/ by wxt.config.ts. Resolve it explicitly:
    // background scripts are classic scripts, where the module's own
    // import.meta.url lookup fails. (WXT only types getURL for files in
    // public/, so widen it here.)
    locateFile: () => (browser.runtime.getURL as (path: string) => string)('/assets/wa-sqlite-async.wasm'),
  });
  const sqlite3 = SQLite.Factory(module);
  const vfs = await IDBBatchAtomicVFS.create(databaseName, module);
  sqlite3.vfs_register(vfs, true);
  const db = await sqlite3.open_v2(`${databaseName}.sqlite`);

  const statements = new Map<string, number>();
  async function prepare(sql: string): Promise<number> {
    const cached = statements.get(sql);
    if (cached !== undefined) {
      // Re-insert to keep the map in least-recently-used order.
      statements.delete(sql);
      statements.set(sql, cached);
      return cached;
    }
    let statement: number | undefined;
    for await (const prepared of sqlite3.statements(db, sql, { unscoped: true })) {
      if (statement !== undefined) throw new Error('Pass one SQL statement at a time; use exec() for scripts.');
      statement = prepared;
    }
    if (statement === undefined) throw new Error('Empty SQL statement.');
    statements.set(sql, statement);
    if (statements.size > statementCacheSize) {
      const [oldest, evicted] = statements.entries().next().value!;
      statements.delete(oldest);
      await sqlite3.finalize(evicted);
    }
    return statement;
  }

  // One statement, rows as value arrays: the contract of Drizzle's
  // sqlite-proxy driver (drizzle-orm/sqlite-proxy).
  async function query(sql: string, params: unknown[]): Promise<SqlValue[][]> {
    const statement = await prepare(sql);
    try {
      if (params.length) sqlite3.bind_collection(statement, params as SqlValue[]);
      const rows: SqlValue[][] = [];
      while (await sqlite3.step(statement) === SQLite.SQLITE_ROW) rows.push(sqlite3.row(statement) as SqlValue[]);
      return rows;
    } finally {
      // A statement left mid-step keeps its read transaction open, which
      // would block every other context's writes.
      await sqlite3.reset(statement);
      sqlite3.clear_bindings(statement);
    }
  }
  const callback: AsyncRemoteCallback = async (sql, params, method) => {
    const rows = await query(sql, params);
    return { rows: method === 'get' ? rows[0] as never : rows };
  };
  const exec = async (sql: string) => { await sqlite3.exec(db, sql); };

  // wa-sqlite's async API must not interleave statements on one connection:
  // SQLite is suspended mid-statement while IndexedDB answers. Callers in one
  // context run concurrently (React effects, message handlers), so each
  // query, or a whole transaction, takes its turn through this queue.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };

  await serial(() => exec('PRAGMA foreign_keys = ON'));
  const unqueued = drizzle(callback, { schema });
  return {
    orm: drizzle((sql, params, method) => serial(() => callback(sql, params, method)), { schema }),
    migrate: (scripts) => serial(async () => {
      await exec('BEGIN IMMEDIATE');
      try {
        const [[version]] = await query('PRAGMA user_version', []) as [[number]];
        if (version > scripts.length) throw new Error('Saved extension data is from a newer version.');
        for (const script of scripts.slice(version)) await exec(script);
        await exec(`PRAGMA user_version = ${scripts.length}`);
        await exec('COMMIT');
      } catch (error) {
        await exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }),
    transaction: (fn) => serial(async () => {
      await exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(unqueued);
        await exec('COMMIT');
        return result;
      } catch (error) {
        await exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }),
  };
}

const connections = new Map<Record<string, unknown>, Promise<Database<Record<string, unknown>>>>();

// One connection per schema per extension context.
export function database<TSchema extends Record<string, unknown>>(schema: TSchema): Promise<Database<TSchema>> {
  let connection = connections.get(schema);
  if (!connection) {
    connection = openConnection(schema).catch((error) => {
      connections.delete(schema);
      throw error;
    });
    connections.set(schema, connection);
  }
  return connection as Promise<Database<TSchema>>;
}
