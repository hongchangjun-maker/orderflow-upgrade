CREATE INDEX of_record_token ON of_records(kind,json_extract(data,'$.token')) WHERE deleted=0;
CREATE INDEX of_dispatch_token ON of_records(json_extract(data,'$.shareToken')) WHERE kind='delivery-plan' AND deleted=0;
CREATE INDEX of_block_mobile ON of_records(shop,json_extract(data,'$.mobile')) WHERE kind='customer-block' AND deleted=0;
CREATE INDEX of_order_children ON of_orders(shop,merged_into,id);
CREATE INDEX of_order_lines ON of_order_items(order_id,id);
