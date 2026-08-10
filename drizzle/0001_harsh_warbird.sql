CREATE TABLE `submission_events` (
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_submission_events_lookup` ON `submission_events` (`fingerprint`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_created` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_customer` ON `orders` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_products_active_sort` ON `products` (`active`,`sort_order`);--> statement-breakpoint
CREATE TRIGGER `prevent_negative_stock`
BEFORE UPDATE OF `stock` ON `products`
WHEN NEW.`stock` < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_stock');
END;
