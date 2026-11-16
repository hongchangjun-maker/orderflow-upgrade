-- Only independent of_ objects. Reconcile the previously ignored inactive flag.
INSERT INTO of_changes(shop,kind,entity,actor,created_at) SELECT shop,'form:inactive-reconcile',CAST(id AS TEXT),'migration-0011',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM of_forms WHERE active=1 AND json_extract(data,'$.use_gbn')='N';
UPDATE of_forms SET active=0,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE active=1 AND json_extract(data,'$.use_gbn')='N';
CREATE TABLE of_owner_credentials(email TEXT PRIMARY KEY,shop TEXT NOT NULL UNIQUE REFERENCES of_shops(id),password_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE of_owner_sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES of_owner_credentials(email),version INTEGER NOT NULL,expires_at TEXT NOT NULL);
CREATE INDEX of_owner_session_expiry ON of_owner_sessions(expires_at);
CREATE TABLE of_customer_access(hash TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES of_shops(id),mobile TEXT NOT NULL,pin_hash TEXT NOT NULL,expires_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX of_customer_access_scope ON of_customer_access(shop,mobile,active);
CREATE TABLE of_customer_sessions(hash TEXT PRIMARY KEY,access_hash TEXT NOT NULL REFERENCES of_customer_access(hash),expires_at TEXT NOT NULL);
CREATE INDEX of_customer_session_expiry ON of_customer_sessions(expires_at);
CREATE TRIGGER of_order_point_guard BEFORE INSERT ON of_orders WHEN COALESCE(json_extract(NEW.data,'$.point_used'),0)<0 OR COALESCE(json_extract(NEW.data,'$.point_used'),0)>NEW.amount BEGIN SELECT RAISE(ABORT,'invalid_point_amount'); END;
CREATE TRIGGER of_point_cancel AFTER UPDATE OF status ON of_orders WHEN NEW.status='40' AND OLD.status<>'40' BEGIN
INSERT INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at) SELECT shop,mobile,kind,-delta,'주문 취소 포인트 복원','point-refund:'||NEW.key,'system',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM of_ledger l WHERE l.shop=NEW.shop AND l.operation='point-order:'||NEW.key AND l.delta<0 AND NOT EXISTS(SELECT 1 FROM of_ledger r WHERE r.shop=NEW.shop AND r.operation='point-refund:'||NEW.key);
END;
CREATE TRIGGER of_point_earn_status AFTER UPDATE OF status ON of_orders WHEN NEW.status='30' AND NEW.ispaid='Y' AND COALESCE(json_extract(NEW.data,'$.point_earn_potential'),0)>0 BEGIN
INSERT OR IGNORE INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at) SELECT NEW.shop,mobile,'point',CAST(json_extract(NEW.data,'$.point_earn_potential') AS INTEGER),'주문 완료 포인트 적립','point-earned:'||NEW.key,'system',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM of_customers WHERE id=NEW.customer_id;
UPDATE of_orders SET data=json_set(data,'$.saved_point',CAST(json_extract(NEW.data,'$.point_earn_potential') AS INTEGER)) WHERE id=NEW.id;
END;
CREATE TRIGGER of_point_earn_payment AFTER UPDATE OF ispaid ON of_orders WHEN NEW.status='30' AND NEW.ispaid='Y' AND COALESCE(json_extract(NEW.data,'$.point_earn_potential'),0)>0 BEGIN
INSERT OR IGNORE INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at) SELECT NEW.shop,mobile,'point',CAST(json_extract(NEW.data,'$.point_earn_potential') AS INTEGER),'주문 완료 포인트 적립','point-earned:'||NEW.key,'system',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM of_customers WHERE id=NEW.customer_id;
UPDATE of_orders SET data=json_set(data,'$.saved_point',CAST(json_extract(NEW.data,'$.point_earn_potential') AS INTEGER)) WHERE id=NEW.id;
END;
CREATE TRIGGER of_point_earned_no_unpay BEFORE UPDATE OF ispaid ON of_orders WHEN OLD.ispaid='Y' AND NEW.ispaid='N' AND EXISTS(SELECT 1 FROM of_ledger WHERE shop=NEW.shop AND operation='point-earned:'||NEW.key) BEGIN SELECT RAISE(ABORT,'point_earned_payment_is_final'); END;
