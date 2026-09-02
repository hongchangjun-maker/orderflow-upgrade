WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 30
)
INSERT OR IGNORE INTO products (
  id, name, category, unit, price, stock, low_stock_at, icon,
  description, active, sort_order, created_at, updated_at
)
SELECT
  printf('load-prod-%02d', n), printf('부하검증 상품 %02d', n), '부하검증', '1상자',
  1000, 1000000, 10, 'BOX', '격리된 로컬 D1 전용 부하검증 상품', 1, 1000 + n,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM seq;

INSERT OR IGNORE INTO products (
  id, name, category, unit, price, stock, low_stock_at, icon,
  description, active, sort_order, created_at, updated_at
) VALUES (
  'load-contended', '재고 경합 검증 상품', '부하검증', '1상자', 20000,
  100, 10, 'BOX', '격리된 로컬 D1 전용 재고 경합 상품', 1, 2000,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO form_products (form_id, product_id, sort_order)
SELECT 'form-fresh', id, sort_order FROM products
WHERE id LIKE 'load-prod-%' OR id = 'load-contended';

UPDATE products SET stock = CASE WHEN id = 'load-contended' THEN 100 ELSE 1000000 END,
  updated_at = CURRENT_TIMESTAMP
WHERE id LIKE 'load-prod-%' OR id = 'load-contended';
