CREATE INDEX `idx_activity_logs_created` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_customers_last_ordered` ON `customers` (`last_ordered_at`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `shops` (`id`, `name`, `tagline`, `phone`, `payment_guide`, `order_complete_message`, `updated_at`) VALUES ('main', '오더플로우 마켓', '좋은 상품을 가장 편한 주문으로', '', '계좌이체 주문은 확인 후 입금 안내를 보내드립니다.', '주문이 접수되었습니다. 확인 후 안내드릴게요.', CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `order_forms` (`id`, `slug`, `title`, `notice`, `min_order_amount`, `shipping_fee`, `free_shipping_at`, `active`, `created_at`, `updated_at`) VALUES ('form-fresh', 'fresh-market', '이번 주 신선마켓', '수량은 실시간 재고 기준이며, 품절 시 주문할 수 없습니다.', 15000, 3500, 50000, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `products` (`id`, `name`, `category`, `unit`, `price`, `stock`, `low_stock_at`, `icon`, `description`, `active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('prod-peach', '햇살 복숭아', '과일', '1팩 · 5입', 16900, 28, 6, 'PEACH', '당도와 향을 선별한 제철 복숭아', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-egg', '목초 유정란', '신선', '30개입', 16400, 16, 5, 'EGG', '난각번호 1번, 매일 입고', 1, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-chicken', '춘천식 닭갈비', '간편식', '500g', 7900, 42, 8, 'PAN', '팬 하나로 완성하는 매콤한 한 끼', 1, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-melon', '머스크 멜론', '과일', '1.5kg 내외', 18900, 4, 5, 'MELON', '후숙 안내를 함께 보내드려요', 1, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-kimchi', '여수 파김치', '반찬', '1kg', 11900, 19, 6, 'LEAF', '갓 버무린 진한 양념', 1, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-curry', '삼일 숙성 카레', '간편식', '210g × 5', 15800, 31, 7, 'BOWL', '전자레인지 3분 간편식', 1, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-pancake', '고기 빈대떡', '간편식', '390g × 2', 11900, 12, 5, 'PAN', '겉바속촉, 막국수와 잘 어울려요', 1, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('prod-noodle', '가평 잣막국수', '간편식', '2인분', 7900, 23, 6, 'NOODLE', '육수와 양념장이 포함된 구성', 1, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `form_products` (`form_id`, `product_id`, `sort_order`) VALUES
  ('form-fresh', 'prod-peach', 0),
  ('form-fresh', 'prod-egg', 10),
  ('form-fresh', 'prod-chicken', 20),
  ('form-fresh', 'prod-melon', 30),
  ('form-fresh', 'prod-kimchi', 40),
  ('form-fresh', 'prod-curry', 50),
  ('form-fresh', 'prod-pancake', 60),
  ('form-fresh', 'prod-noodle', 70);--> statement-breakpoint
PRAGMA optimize;
