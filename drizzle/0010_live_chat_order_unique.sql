CREATE UNIQUE INDEX of_chat_order_unique ON of_records(shop,json_extract(data,'$.orderKey')) WHERE kind='chat-room' AND deleted=0;
