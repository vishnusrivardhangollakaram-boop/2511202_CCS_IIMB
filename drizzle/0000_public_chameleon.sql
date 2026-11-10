CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`version` integer NOT NULL,
	`event` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_case_version` ON `audit_events` (`case_id`,`version`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`last_operation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cases_owner_request` ON `cases` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `cases_owner_updated` ON `cases` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `corpus_articles` (
	`key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`payload` text NOT NULL,
	`search_text` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_owner_article` ON `corpus_articles` (`owner_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `corpus_owner` ON `corpus_articles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry` ON `rate_limits` (`expires_at`);