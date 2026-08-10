CREATE TABLE `admin_login_attempts` (
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_admin_login_attempts_lookup` ON `admin_login_attempts` (`fingerprint`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `idempotency_key` text;--> statement-breakpoint
CREATE INDEX `idx_orders_created` ON `orders` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_idempotency_key` ON `orders` (`idempotency_key`);