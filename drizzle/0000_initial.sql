CREATE TABLE `core_archiveresult` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`plugin` text NOT NULL,
	`hook_name` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`end_ts` text,
	`output_str` text DEFAULT '' NOT NULL,
	`output_json` text NOT NULL,
	`output_files` text NOT NULL,
	`output_size` integer DEFAULT 0 NOT NULL,
	`delete_at` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `core_snapshot`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_archiveresult_per_snapshot_hook` ON `core_archiveresult` (`snapshot_id`,`plugin`,`hook_name`);--> statement-breakpoint
CREATE INDEX `core_archiveresult_delete_at` ON `core_archiveresult` (`delete_at`) WHERE "core_archiveresult"."delete_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `core_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`created_by_username` text NOT NULL,
	`url` text NOT NULL,
	`bookmarked_at` text NOT NULL,
	`title` text NOT NULL,
	`depth` integer NOT NULL,
	`delete_at` text,
	`favIconUrl` text,
	`persona_overrides` text,
	`unassigned_remote_copy` text
);
--> statement-breakpoint
CREATE INDEX `core_snapshot_url` ON `core_snapshot` (`url`);--> statement-breakpoint
CREATE INDEX `core_snapshot_bookmarked_at` ON `core_snapshot` (`bookmarked_at`);--> statement-breakpoint
CREATE INDEX `core_snapshot_title` ON `core_snapshot` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `core_snapshot_delete_at` ON `core_snapshot` (`delete_at`) WHERE "core_snapshot"."delete_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `core_snapshot_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `core_snapshot`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_snapshot_tags_snapshot_tag` ON `core_snapshot_tags` (`snapshot_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `core_tag` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`name` text NOT NULL,
	`num_snapshots` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_tag_name_unique` ON `core_tag` (`name`);--> statement-breakpoint
CREATE TABLE `remote_copies` (
	`snapshot_id` text NOT NULL,
	`server_id` text NOT NULL,
	`remote_copy` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `server_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `core_snapshot`(`id`) ON UPDATE no action ON DELETE cascade
);
