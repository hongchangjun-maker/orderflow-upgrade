-- Opt-in grouping only, never implicit fee discounts or point/prepay aggregation.
-- Inside the order insert transaction, concurrent submissions cannot select two new roots.
CREATE TRIGGER of_safe_same_day_merge AFTER INSERT ON of_orders
WHEN NEW.status='00' AND NEW.ispaid='N'
 AND COALESCE(json_extract(NEW.data,'$.point_used'),0)=0
 AND COALESCE(json_extract(NEW.data,'$.pay_gbn'),'transfer')<>'prepay'
 AND COALESCE(json_extract(NEW.data,'$.ispresent'),'N')='N'
 AND EXISTS(SELECT 1 FROM of_shops WHERE id=NEW.shop AND json_extract(settings,'$."/delivery-fee/urlorder/'||NEW.form_id||'/link".sameDayMerge') IN (1,'true','Y'))
BEGIN
 UPDATE of_orders SET merged_into=(
  SELECT p.id FROM of_orders p
  WHERE p.shop=NEW.shop AND p.form_id=NEW.form_id AND p.customer_id=NEW.customer_id
   AND p.order_date=NEW.order_date AND p.id<NEW.id AND p.merged_into IS NULL
   AND p.status='00' AND p.ispaid='N'
   AND COALESCE(json_extract(p.data,'$.point_used'),0)=0
   AND COALESCE(json_extract(p.data,'$.ispresent'),'N')='N'
   AND COALESCE(json_extract(p.data,'$.addr'),'')=COALESCE(json_extract(NEW.data,'$.addr'),'')
   AND COALESCE(json_extract(p.data,'$.addr2'),'')=COALESCE(json_extract(NEW.data,'$.addr2'),'')
   AND COALESCE(json_extract(p.data,'$.delivery_gbn'),'direct')=COALESCE(json_extract(NEW.data,'$.delivery_gbn'),'direct')
   AND COALESCE(json_extract(p.data,'$.pickup_time'),'')=COALESCE(json_extract(NEW.data,'$.pickup_time'),'')
   AND COALESCE(json_extract(p.data,'$.pay_gbn'),'transfer')=COALESCE(json_extract(NEW.data,'$.pay_gbn'),'transfer')
  ORDER BY p.id LIMIT 1
 ) WHERE id=NEW.id;
 UPDATE of_orders SET revision=revision+1,updated_at=NEW.updated_at
 WHERE id=(SELECT merged_into FROM of_orders WHERE id=NEW.id);
 INSERT INTO of_changes(shop,kind,entity,actor,created_at)
 SELECT NEW.shop,'order:merge',CAST(merged_into AS TEXT),'system',NEW.created_at
 FROM of_orders WHERE id=NEW.id AND merged_into IS NOT NULL;
END;
