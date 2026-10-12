import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// The extension's database schema. Only models.ts imports it (and
// drizzle.config.ts, to generate migrations into drizzle/). After changing it,
// run `pnpm db:generate` and commit the new migration.
//
// Tables, columns and names follow the ArchiveBox server's models
// (archivebox/core/models.py: Snapshot, ArchiveResult, Tag, SnapshotTag; their
// db_table names; and the search_backend_sqlite plugin's search_index),
// keeping only the fields the extension uses, so a snapshot moves between the
// browser and a server without translation. Only two things have no server
// equivalent and keep the extension's existing names: per-server receipts
// (remote_copies, from Snapshot.remote_copies) and the extension-only snapshot
// fields (favIconUrl, persona_overrides, unassigned_remote_copy).
//
// Timestamps are ISO 8601 strings. Indexes are only those a query in
// models.ts needs: the same queries serve 100 or 1M snapshots.
//
// Not expressible here, so written by hand in drizzle/0001_search_and_tag_counts.sql:
// the search_index FTS5 table and the triggers that keep it and
// core_tag.num_snapshots current.

export const core_snapshot = sqliteTable('core_snapshot', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  modified_at: text('modified_at').notNull(),
  created_by_username: text('created_by_username').notNull(),
  url: text('url').notNull(),
  bookmarked_at: text('bookmarked_at').notNull(),
  title: text('title').notNull(),
  depth: integer('depth').notNull(),
  // The server's ModelWithDeleteAfter.delete_at: when local retention may
  // remove this row (null: never, or not yet confirmed by every server).
  delete_at: text('delete_at'),
  favIconUrl: text('favIconUrl'),
  persona_overrides: text('persona_overrides', { mode: 'json' }).$type<Record<string, string>>(),
  unassigned_remote_copy: text('unassigned_remote_copy', { mode: 'json' }),
}, (table) => [
  index('core_snapshot_url').on(table.url),
  index('core_snapshot_bookmarked_at').on(table.bookmarked_at),
  index('core_snapshot_title').on(sql`${table.title} COLLATE NOCASE`),
  index('core_snapshot_delete_at').on(table.delete_at).where(sql`${table.delete_at} IS NOT NULL`),
]);

export const core_archiveresult = sqliteTable('core_archiveresult', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  modified_at: text('modified_at').notNull(),
  snapshot_id: text('snapshot_id').notNull().references(() => core_snapshot.id, { onDelete: 'cascade' }),
  plugin: text('plugin').notNull(),
  hook_name: text('hook_name').notNull().default(''),
  status: text('status').notNull(),
  end_ts: text('end_ts'),
  output_str: text('output_str').notNull().default(''),
  // The extension's local capture record (SnapshotScreenshot, SnapshotMhtml, ...).
  output_json: text('output_json', { mode: 'json' }).notNull(),
  // {path relative to the plugin folder: metadata}, like the server's.
  output_files: text('output_files', { mode: 'json' }).$type<Record<string, Record<string, unknown>>>().notNull(),
  output_size: integer('output_size').notNull().default(0),
  delete_at: text('delete_at'),
}, (table) => [
  uniqueIndex('unique_archiveresult_per_snapshot_hook').on(table.snapshot_id, table.plugin, table.hook_name),
  index('core_archiveresult_delete_at').on(table.delete_at).where(sql`${table.delete_at} IS NOT NULL`),
]);

export const core_tag = sqliteTable('core_tag', {
  id: integer('id').primaryKey(),
  created_at: text('created_at').notNull(),
  modified_at: text('modified_at').notNull(),
  name: text('name').notNull().unique(),
  // The server API's Tag.num_snapshots, kept current by triggers so tag
  // lists never count rows. Tags reaching 0 are removed.
  num_snapshots: integer('num_snapshots').notNull().default(0),
});

export const core_snapshot_tags = sqliteTable('core_snapshot_tags', {
  id: integer('id').primaryKey(),
  snapshot_id: text('snapshot_id').notNull().references(() => core_snapshot.id, { onDelete: 'cascade' }),
  // No foreign key: deleting an unused tag would otherwise scan this table.
  tag_id: integer('tag_id').notNull(),
}, (table) => [
  uniqueIndex('core_snapshot_tags_snapshot_tag').on(table.snapshot_id, table.tag_id),
]);

export const remote_copies = sqliteTable('remote_copies', {
  snapshot_id: text('snapshot_id').notNull().references(() => core_snapshot.id, { onDelete: 'cascade' }),
  server_id: text('server_id').notNull(),
  remote_copy: text('remote_copy', { mode: 'json' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshot_id, table.server_id] }),
]);
