CREATE TABLE `delivery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`service_date` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_by` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_runs_date_status` ON `delivery_runs` (`service_date`,`status`);--> statement-breakpoint
CREATE TABLE `delivery_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`order_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`arrived_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_stops_order_id_unique` ON `delivery_stops` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_delivery_stops_run_sequence` ON `delivery_stops` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `message_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`customer_id` text,
	`order_id` text,
	`recipient_name` text NOT NULL,
	`recipient_phone` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`provider` text DEFAULT 'unconfigured' NOT NULL,
	`scheduled_at` text,
	`sent_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_message_outbox_status_created` ON `message_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_message_outbox_order` ON `message_outbox` (`order_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_message_templates_active` ON `message_templates` (`active`,`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `message_templates` (`id`, `name`, `kind`, `body`, `active`, `created_at`, `updated_at`) VALUES
  ('tpl-order-received', '주문 접수 안내', 'INFO', '안녕하세요, {상점명}입니다. {고객명} 고객님의 주문({주문번호})이 접수되었습니다. 주문 확인: {주문링크}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tpl-shipping', '배송 출발 안내', 'INFO', '안녕하세요, {상점명}입니다. {고객명} 고객님의 주문({주문번호})이 배송을 시작했습니다. 신선하게 전달해 드리겠습니다.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tpl-restock', '재입고 알림', 'AD', '(광고) 안녕하세요, {상점명}입니다. 기다리시던 상품이 다시 입고되었습니다. 주문: {주문링크}\n(수신거부는 회신 부탁드립니다)', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
