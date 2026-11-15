CREATE TRIGGER of_prepay_cancel AFTER UPDATE OF status ON of_orders WHEN NEW.status='40' AND OLD.status<>'40' BEGIN
INSERT INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at)
SELECT shop,mobile,kind,-delta,'주문 취소에 따른 선결제 잔액 복원','prepay-refund:'||NEW.key,'system',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM of_ledger l WHERE l.shop=NEW.shop AND l.operation='prepay-order:'||NEW.key AND l.delta<0 AND NOT EXISTS(SELECT 1 FROM of_ledger r WHERE r.shop=NEW.shop AND r.operation='prepay-refund:'||NEW.key);
END;
CREATE TRIGGER of_prepay_no_unpay BEFORE UPDATE OF ispaid ON of_orders WHEN OLD.ispaid='Y' AND NEW.ispaid='N' AND NEW.status<>'40' AND EXISTS(SELECT 1 FROM of_ledger WHERE shop=NEW.shop AND operation='prepay-order:'||NEW.key) BEGIN SELECT RAISE(ABORT,'prepay_payment_is_final'); END;
