DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM customers;
DELETE FROM activity_logs;
DELETE FROM submission_events;

UPDATE products SET stock = CASE WHEN id = 'load-contended' THEN 100 ELSE 1000000 END,
  updated_at = CURRENT_TIMESTAMP
WHERE id LIKE 'load-prod-%' OR id = 'load-contended';
