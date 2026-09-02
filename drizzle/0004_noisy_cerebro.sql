ALTER TABLE `orders` ADD `request_hash` text;--> statement-breakpoint
CREATE INDEX `idx_orders_created_id` ON `orders` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_admin_login_attempts_created` ON `admin_login_attempts` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_submission_events_created` ON `submission_events` (`created_at`);