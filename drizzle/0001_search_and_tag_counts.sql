-- Written by hand: drizzle-kit cannot express FTS5 tables or triggers.

-- Substring search over URL, title and tags (content), as the Saved URLs
-- search has always matched; the trigram tokenizer serves it from an index.
-- Same table and columns as the server's search_backend_sqlite plugin.
-- rowid is the core_snapshot rowid; models.ts writes it on every save.
CREATE VIRTUAL TABLE `search_index` USING fts5(`snapshot_id` UNINDEXED, `url`, `title`, `content`, tokenize = 'trigram');
--> statement-breakpoint
CREATE TRIGGER `core_snapshot_search_index_delete` AFTER DELETE ON `core_snapshot` BEGIN
  DELETE FROM `search_index` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
-- core_tag.num_snapshots and recency (modified_at) follow core_snapshot_tags,
-- so tag lists never count rows; unused tags are removed.
CREATE TRIGGER `core_snapshot_tags_insert` AFTER INSERT ON `core_snapshot_tags` BEGIN
  UPDATE `core_tag` SET `num_snapshots` = `num_snapshots` + 1, `modified_at` = strftime('%Y-%m-%dT%H:%M:%fZ') WHERE `id` = new.`tag_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `core_snapshot_tags_delete` AFTER DELETE ON `core_snapshot_tags` BEGIN
  UPDATE `core_tag` SET `num_snapshots` = `num_snapshots` - 1 WHERE `id` = old.`tag_id`;
  DELETE FROM `core_tag` WHERE `id` = old.`tag_id` AND `num_snapshots` <= 0;
END;
