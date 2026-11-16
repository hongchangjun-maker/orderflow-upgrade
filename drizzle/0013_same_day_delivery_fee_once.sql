-- Retained source UI explicitly describes sameDayMerge as one delivery fee per day.
-- The waiver is atomic even when several independent Workers quote before the first commit.
CREATE TRIGGER of_same_day_delivery_fee_once AFTER INSERT ON of_orders
WHEN NEW.fee>0
 AND EXISTS(SELECT 1 FROM of_shops WHERE id=NEW.shop AND json_extract(settings,'$."/delivery-fee/urlorder/'||NEW.form_id||'/link".sameDayMerge') IN (1,'true','Y'))
 AND EXISTS(
 SELECT 1 FROM of_orders p WHERE p.shop=NEW.shop AND p.form_id=NEW.form_id
 AND p.customer_id=NEW.customer_id AND p.order_date=NEW.order_date AND p.id<NEW.id AND p.status<>'40' AND p.fee>0
 AND COALESCE(json_extract(p.data,'$.addr'),'')=COALESCE(json_extract(NEW.data,'$.addr'),'')
 AND COALESCE(json_extract(p.data,'$.addr2'),'')=COALESCE(json_extract(NEW.data,'$.addr2'),'')
 AND COALESCE(json_extract(p.data,'$.delivery_gbn'),'direct')=COALESCE(json_extract(NEW.data,'$.delivery_gbn'),'direct')
 AND COALESCE(json_extract(p.data,'$.pickup_time'),'')=COALESCE(json_extract(NEW.data,'$.pickup_time'),'')
 ) BEGIN UPDATE of_orders SET fee=0 WHERE id=NEW.id; END;
