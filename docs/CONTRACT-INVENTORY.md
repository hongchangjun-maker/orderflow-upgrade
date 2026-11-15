# Preserved UI contract inventory

Static research only. No original server, browser session, records, or credentials were accessed. Source: `public/replica-assets/application.js`, SHA-256 `1f45dd1fe33b9c8dd9334593df18bc5a40f3ee08bc7c6e1f4247729004a719e1`. Offsets below are UTF-16 offsets in that exact artifact; regeneration can move offsets. These are **client expectations**, not verified original backend behavior.

Every ordinary success envelope is `{success:true,data:...}`; ordinary failures expose `{success:false,error:{message,...}}`. HTTP errors are read through `error.response.data.error.message`. Do not turn unimplemented writes into success. IDs, ownership, price, balances, stock, and permissions must be validated server-side.

## Forms and builder items

Evidence: `Are`, `IE`, `hMe`, `pMe` at 1261770–1262500; builder state/validation at 1278026–1285900; item base `Yb` at 1427480.

| Request | Expected body/query | `data` consumed by UI |
| --- | --- | --- |
| GET `/urlorders/setting/:uocode` | numeric saved form ID | `{setting,items:[],payMethods:[],deliveryMethods:[],imageThumbUrl?}` |
| POST `/urlorders/setting` | Flatten `{...setting,items,payMethods,deliveryMethods}` | `{int_value1:<saved uocode>}`; then UI immediately GETs saved form |
| PUT `/urlorders/setting/:uocode` | same flattened body | success; then UI immediately GETs saved form |
| POST `/urlorders/setting/item-import` | `{from_date,to_date}` (`YYYYMMDD`) | array of items, not `{items:[]}` |
| POST `/urlorders/setting/save-orderitem` | `{order_date,items:[{...item,seqno:0}]}` | success only |
| POST `/urlorders/setting/item-detail-get` | `{seqno}` | item fields plus detail fields below |
| POST `/urlorders/setting/item-detail-save` | `{seqno,...detailFields}` | `{affected:number}` |
| POST `/urlorders/setting/item-save` | `{uocode,seqno,update_date?,...changedItemFields}` | `{update_date:string,stock:number,cost:number}` |
| POST `/urlorders/setting/use-item-detail-save` | `{uocode,use_item_detail:'Y'|'N'}` | `{affected:number}` |
| POST `/urlorders/setting/item-images` | `{uocode}` | `{urls:{[seqno]:string[]},fcodekeys:{[seqno]:string[]}}` |
| POST `/urlorders/setting/item-images-save` | `{seqno,fcodekeys:string[]}` (exactly five padded slots) | `{urls:string[]}` |
| GET `/urlorder-v2/hub` | `recent=20,page=0,useOnly=Y|N` | `{rows:[],totalCnt:number}`; rows use fields below |
| POST `/urlorder-v2/ui-mark` | `{uocode,ui:'V3'|<old kind>}` | success only |
| POST `/urlorders/list` | `{pageIndex,pageSize}` | array of forms, not object; pagination continues when returned length >= pageSize |

`item-save` conflict contract: HTTP 409 with `error.message` and `data:{update_date,stock,cost}`. UI exposes conflict and returned current revision/stock/price. Never ignore the revision.

Form item base:

```js
{ seqno:0, iname:'', unit:'개', cost:0, stock:100, disp_gbn:'Y',
  vat_gbn:'N', fcodekey:'', cat_gbn:'', item_max_qty:0, item_min_qty:0,
  stock_visible_gbn:'N', stock_visible_qty:0 }
```

`cat_gbn:'CAT'` is a separator, not a saleable item. New items may have negative temporary `seqno`; server must allocate positive persistent IDs. Copy-as-new resets `uocode`, item `seqno`, method `seqno`, URLs and token. It can carry `_makeStock` and include/exclude archived items/methods. Avoid reusing original IDs in an independent store.

Detail fields: `origin_country,livestock_trace_no,allergens,content_amount,expiry_info,storage_method,manufacturer,detail_html`; item-detail GET also uses `seqno,uocode,iname,unit,cost,cat_gbn,fcodekey,use_item_detail`. `detail_html` needs server sanitization; UI does not establish safety.

Form `setting` defaults observed in `lRe()`:

```js
{uocode:0,order_date:'YYYYMMDD',use_gbn:'Y',expire_date:'YYYYMMDD',expire_time:'2000',
 notice:'',contents:'',delivery_deliver:'Y',delivery_pickup:'Y',delivery_parcel:'N',
 pay_tran:'Y',pay_pg:'N',tran_bank_info:'',pay_inform:'',token:'',url_short:'',url:'',
 use_image:'N',title:'',open_date:'YYYYMMDD',open_time:'0000',delivery_date:'YYYYMMDD',
 delivery_tip_gbn:'NO_TIP',delivery_tip:'N',delivery_amt_arr:'',delivery_tip_arr:'',
 delivery_tip_min_amt:0,delivery_tip_min_amt_message:'',cash_receipt_gbn:'Y',
 use_addr_search:'Y',use_pickup_time:'N',pickup_time_arr:'',use_customer_save_point:'N',
 customer_point_rate:0,use_customer_use_point:'N',use_present:'N',use_today_display:'Y',
 use_search_gbm:'N',use_sns_bot:'N',sns_gbn:'',sns_info:'',contact_telno:''}
```

Saved data additionally uses `urlorderno,url_gbn,update_date,use_item_detail`. `url_gbn:'V3'` identifies v2 presentation. Do not silently drop unknown form option fields—the builder spreads them back into save.

Default pay methods are `{seqno,pay_name,use_gbn,sort_gbn}`: 계좌이체/매장결제 enabled, 선결제/체크·신용카드 disabled. Custom delivery methods use at least `{seqno,delivery_name,use_gbn,part_gbn,...}`. UI validates one saleable item, title, at least one delivery and payment method, and open datetime < expiry datetime.

Hub rows use `uocode,title,urlorderno,token,url,url_short,url_gbn,use_gbn,status,open_date,open_time,expire_date,expire_time,delivery_date,section,close_min,remain_min`. `section:'RECENT'` controls pagination. Status normalization accepts LIVE/SOON/DONE/OFF or OPEN/READY/CLOSED. Evidence: 1274550–1275700 and hub consumer 2894535.

## Order details, status, payment and merging

Evidence: `fW` at 1965814, detail/load/save at 1969974–1972900; status/payment at 2765973; merge at 2809014,2813518,2820194.

| Request | Body | Required response `data` |
| --- | --- | --- |
| POST `/orders/detail` | `{ocodekey,orderno}` | `{header,items:[],availableItems:[]}` |
| PUT `/orders/save-items` | `{ocodekey,order_date,order_amt,delivery_amt,items:[{iname,unit,cost,qty}]}` | `{order_amt,delivery_amt,contents}` |
| PUT `/orders/save` | `{ocodekey,orderno,...draftHeader,pickup_time,order_amt,delivery_amt,contents}` | `{header,items:[]}` |
| PUT `/orders/status` | `{orders:[{ocodekey,orderno}],status}` | `{updated:number,failed:number}` — failed is NOT an array |
| PUT `/orders/payment` | `{orders:[{ocodekey,orderno}],ispaid:'Y'|'N'}` | `{updated:number,failed:number}` |
| PUT `/orders/prepay-deduct` | `{orders:[{ocodekey,orderno,tamt}]}` | `{updated:number,failed:number,results:[{orderno,error_no,error_msg}]}` |
| GET `/orders/share-link` | `ocodekey` | `{url:string}` |
| POST `/orders/merge-list` | `{order_date:'YYYYMMDD'}` | `{orders:[]}` |
| POST `/orders/merged-detail` | `{ocodekey_arr:'comma,keys',gbn:''}` | `{orders:[]}` |
| PUT `/orders/merge` | `{mobile_arr:<single mobile>,ocodekey_arr:'comma,keys'}` | `{error_no:0,error_msg?}` on confirmed merge |

Merge preserves the first `ocodekey` in the comma list: the UI sorts selected `isFirst` order to index 0. It requires at least two selected orders per mobile. Successful groups remove all selected old keys from the merge list. Implement atomically and idempotently; success-only envelope is insufficient because client checks `data.error_no===0`.

`draftHeader` fields from `fW(header)`:

```js
{status,delivery_gbn,delivery_part_gbn,packing,delivery,postal,addr,addr2,door_pw,
 pickup_time,pay_gbn,tranname,cash_receipt,damt,order_amt,delivery_amt,memo,delivery_memo}
```

Header additionally uses `ocodekey,orderno,uocode,order_date,ordernumber,contents,tran_name`. `ordernumber` marks merged orders whose fee is locked. Detail item output is `{item_name,unit,disp,qty,price}`, not `{iname,cost}`; availableItems is a separate catalog. Status codes: 00 waiting,10 received,22 packing,24 delivering,30 done,40 cancelled. Client transition helper disallows changes after 30/40 and permits selected reverse transitions 24→22,22→10; server must enforce its own transition rules.

Delivery/pay selector GETs return arrays. Delivery rows use `{code_name,part_gbn,use_pickup_time,use_door_pw,use_addressbook,use_address_input_type}`; client matches `code_name` to order `delivery_gbn`. GET `/orders/compute-delivery-amt?uocode=...&order_amt=...` is also called. Preserve scalar/camel conversions deliberately.

## Recurring orders

Evidence: detail/selection 2918500–2920801, save 2922262, list/status/delete 2939053–2939600.

- POST `/recurring-orders/list` body `{status?,search?}` → `data` is array.
- GET `/recurring-orders/summary` → `{active_count,paused_count,this_week_count,this_month_count}`.
- GET `/recurring-orders/detail/:rocode` → `{master,items:[]}`.
- GET `/recurring-orders/urlorder-items/:uocode` → `{items:[],deliveryOptions:[],payOptions:[]}`; options use at least `{value,label}`.
- PUT `/recurring-orders/status` body `{rocode,status:'active'|'paused'|'ended'}` → success.
- DELETE `/recurring-orders/:rocode` → success.
- POST `/recurring-orders/save` body:

```js
{rocode?,uocode?,cust_name,mobile,postal?,addr?,addr2?,
 schedule_type:'weekly'|'biweekly'|'monthly',schedule_days:JSON.stringify(days),
 delivery_gbn,pay_gbn,send_alimtalk:'Y'|'N',generate_hour,memo?,status:'active',
 start_date,end_date?,next_order_date?,items:[{iname,unit,cost,qty}]}
```

`days` is string weekday keys (`mon` etc.) except monthly numeric day-of-month. Master returns same fields. Client generates a proposed next_order_date; server must independently compute and validate it. No original scheduler behavior was observed, so retries/DST/leap-month semantics are unknown and need an explicit independent policy.

## Account permissions

Evidence: bJe/yJe/vJe 3452499, FJe 3455716.

- GET `/account/perms` → `data:{accounts:[],catalog:[],cells:[]}`.
- Accounts: `{ucode,userName,userId,role:'OWNER'|'ADMIN'|'STAFF',lastLogin}`.
- Catalog: `{code,name,group,sortNo,desc}`. Groups include 돈,고객,운영,설정,아이디.
- Cells: `{ucode,code,on:boolean,explicit:boolean,locked:boolean}`.
- PUT `/account/perms/:ucode/:encodedCode` body `{on:boolean}` → success; UI updates local cell only after response.
- GET `/account/perms/mine` → `{role,userLevel,perms:{[code]:boolean}}`.
- OWNER/ADMIN are shown locked/enabled; STAFF is mutable. Browser hiding is not security. Server must disallow owner permissions being switched off and must check the actual actor/shop membership.
- Known frontend gate codes: `SALES_VIEW`,`PREPAY_POINT`,`ORDER_OPS`. This is not necessarily the full original catalog.

## Seller chat

Evidence: API wrapper `iY` 312722; room consumer IKe 3076649; room list rle 3039678; message rendering 3047400 onward.

| Request | Body/query | `data` |
| --- | --- | --- |
| GET `/chat/rooms` | `filter=unread|all|closed,page=1` | `{rooms:[]}` |
| GET `/chat/rooms/:roomId` | room ID | `{room,customer,orders:[]}` |
| GET `/chat/rooms/:roomId/messages` | `before?,limit=50` | `{messages:[]}` |
| POST `/chat/rooms/:roomId/messages` | below | `{message,notify?:{alimtalkQueued?:boolean}}` |
| POST `/chat/rooms/:roomId/read` | none | success |
| POST `/chat/rooms/:roomId/close` | none | success |
| POST `/chat/rooms/:roomId/reopen` | none | success |
| POST `/chat/rooms/:roomId/mute` | `{mute:boolean}` | success |
| POST `/chat/rooms/open` | observed `{mobile,orderNo}` | `{roomId}` |
| POST `/chat/upload` | FormData file (image UI limit 10MB) | `{kind,fileUrl,thumbUrl,fileName,fileSize}` |
| GET `/chat/settings` | none | `{settings}` |
| PUT `/chat/settings` | raw settings object | success |
| GET `/chat/quick-replies` | none | `{quickReplies:[]}` |
| PUT `/chat/quick-replies` | raw quick reply array | success |
| GET `/chat/unread` | none | `{unread:number}` |
| POST `/chat/orders/display` | `{keys:string[]}` | `{items:[]}` |

Room list row: `{roomId,customerName,mobile,mobileMasked,lastOrderNo,lastOrderDisplay,lastMessage,lastAt,lastSender,lastSenderName,unread,blocked}`.

Room detail: `room:{roomId,status:'O'|'C',mobile,mute,lastOrderNo,lastOrderDisplay}`; `customer:{name,mobileMasked,orderCount,firstOrderDt}`; `orders` rows use `orderNo,ocodekey,orderNoSeq?,orderDt,status,statusName,amount,itemsSummary,deliveryGbn`.

Message: `{msgId,type:'text'|'image'|'file'|'order'|'system'|'greeting',sender:'S'|'C'|'A',senderName?,content,createdAt,readAt?,orderNo?,orderCard?,fileUrl?,thumbUrl?,fileName?,fileSize?,notifiedViaAlimtalk?}`.

Send bodies: `{type:'text',content}`, `{type:'order',orderNo}`, or `{type:kind,content,fileUrl,thumbUrl,fileName,fileSize}`. An actual provider delivery result must not be invented in `notify.alimtalkQueued`.

Settings require `{enabled,bizHours:{from:'HH:mm',to:'HH:mm',days:'YYYYYNN'},autoReplyOffHours,autoReplyText,notifyPc,notifyApp,greeting?}`. Days are Monday-first seven Y/N characters. Equal from/to means 24 hours. Source default for invalid days is `YYYYYYN`; new backend should validate rather than silently accept invalid shapes.

Realtime client listens for `chat:new`, `chat:read`, inquiry events and order events; passive polling can be used as an independent transport, but transport success must reflect real persisted changes.

## Customer chat is a separate public-token contract

Evidence: `Eu` at 3530341, customer page nQe later in same artifact. This is not the public customer order-entry form.

- GET `/c/:token` with `s?,e?` query and source token header helper.
- POST `/c/:token/pin` body `{last4}`.
- POST `/c/:token/messages`, `/read`; GET `/c/:token/poll?after=...`.
- GET `/c/:token/orders?page=1&size=10` → `{orders:[],total:number}`.
- POST `/c/:token/orders/display` body `{keys}`.
- GET `/c/:token/orders/:id` → `{order,items:[]}` (items use `{seq,name,qty,cost}`).
- POST `/upload` FormData file and token headers; POST `/c/:token/push-subscribe` body `{subscription}`.
- Public customer order rows use `ocode,orderNo,orderDt,status,statusName,amount,itemsSummary,deliveryGbn`; detail additionally uses `payGbn,addr,addr2,telno,mobile,doorPw,deliveryMemo,atContent`.
- Customer message merge is deduplicated/sorted by numeric `msgId`.

Never use enumerable numeric room IDs as customer authority. Independent signed/opaque scoped tokens, PIN throttling, expiry, cross-shop checks, attachment validation and actual read receipts require server tests.

## Deliberate unknowns

This inventory does not recover original SQL, exact authorization policy, transaction behavior, payment/tax/provider contracts, or full DTO validation. Arbitrary spread fields in setting/header saves mean original server accepts more keys than this client visibly consumes. Do not claim completeness or backend equivalence from these static observations alone.
