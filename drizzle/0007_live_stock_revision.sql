DROP TRIGGER of_stock_cancel;
CREATE TRIGGER of_stock_cancel AFTER UPDATE OF status ON of_orders WHEN NEW.status='40' AND OLD.status<>'40' BEGIN UPDATE of_items SET stock=stock+COALESCE((SELECT quantity FROM of_order_items WHERE order_id=NEW.id AND item_id=of_items.id),0),revision=revision+1 WHERE id IN (SELECT item_id FROM of_order_items WHERE order_id=NEW.id); END;
