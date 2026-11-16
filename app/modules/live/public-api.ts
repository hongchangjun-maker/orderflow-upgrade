import { getD1 } from "../../lib/data";
import { scopedFingerprint } from "../../lib/security";
import {
  messages,
  openCustomerRoom,
  publicChatContext,
  send,
} from "./communications";
import { LiveError, obj, publicNotice, text, type Doc } from "./domain";
import { formDetail } from "./forms";
import { createLiveOrder } from "./orders";
import { customerProfile,verifiedCustomer } from "./customer-access";
import { quoteOrder } from "./order-quote";
import { amountDue,paymentOptions } from "./pricing";
import { cleanHtml } from "./html";
import { upload } from "./media";
import { failure, readInput, success } from "./router";
import { now, parse, transaction, type LiveContext } from "./store";
export async function publicApi(request: Request) {
  // Only this endpoint has a required durable idempotency key. Never replay
  // arbitrary chat messages, uploads, money operations or seller mutations.
  const safeOrder=request.method==='POST'&&/^\/api\/live-public\/form\/[a-f\d]{32}$/u.test(new URL(request.url).pathname);
  for(let attempt=0;;attempt++){
    const response=await publicApiOnce(safeOrder?request.clone() as Request:request);
    if(!safeOrder||response.status!==503||attempt>=2)return response;
    await response.body?.cancel();
    await new Promise(resolve=>setTimeout(resolve,12000+attempt*3000+Math.floor(Math.random()*4000)));
  }
}
async function publicApiOnce(request: Request) {
  try {
    const db = getD1(),
      url = new URL(request.url),
      parts = url.pathname.replace(/^\/api\/live-public\//u, "").split("/");
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new LiveError("허용되지 않은 요청입니다.", 403);
    }
    const isUpload=parts[0]==='chat'&&parts[2]==='upload'&&request.method==='POST'&&request.headers.get('content-type')?.includes('multipart/form-data');
    const data = obj(request.method === "GET"||isUpload ? {} : await readInput(request));
    if (!["GET", "POST"].includes(request.method))
      throw new LiveError("허용되지 않은 요청 방식입니다.", 405);
    if(parts[0]==='customer')return await customerProfile(db,request,parts[1],request.method==='POST'?data:undefined);
    if (parts[0] === "form") {
      const token = parts[1];
      if (!/^[a-f\d]{32}$/u.test(token))
        throw new LiveError("유효하지 않은 주문서입니다.", 404);
      const form = await db
        .prepare(
          "SELECT f.*,s.name,s.settings FROM of_forms f JOIN of_shops s ON s.id=f.shop WHERE f.token=? AND f.active=1",
        )
        .bind(token)
        .first<Doc>();
      if (!form) throw new LiveError("마감되었거나 없는 주문서입니다.", 404);
      const c: LiveContext = {
        db,
        shop: String(form.shop),
        actor: "customer",
        role: "CUSTOMER",
        permissions: {},
        origin: url.origin,
      };
      const customer=await verifiedCustomer(db,request,c.shop);
      if(customer)c.actor=`customer:${customer.mobile}`;
      if (request.method === "GET") {
        const detail = await formDetail(c, Number(form.id));
        const shop = obj(parse(form.settings).shop);
        return success({
          id: form.id,
          token,
          title: detail.setting.title,
          notice: publicNotice(detail.setting),
          shopName: form.name,
          phone: shop.kms_callback_mobile ?? "",
          paymentGuide:
            detail.setting.tran_bank_info ??
            detail.setting.pay_inform ??
            "매장 안내에 따라 입금해 주세요.",
          shippingFee: Number(
            detail.setting.shipping_fee ?? detail.setting.delivery_amt ?? 0,
          ),
          minOrderAmount: Number(detail.setting.min_order_amount ?? 0),
          paymentOptions:paymentOptions(detail.setting,detail.payMethods),
          options:{
            usePickupTime:detail.setting.use_pickup_time==='Y',
            pickupTimes:Array.isArray(detail.setting.pickupTimes)?detail.setting.pickupTimes:text(detail.setting.pickup_time_arr).split(',').map(v=>v.trim()).filter(Boolean),
            cashReceipt:detail.setting.cash_receipt_gbn!=='N',
            present:detail.setting.use_present==='Y',
            pointEnabled:detail.setting.use_customer_use_point==='Y'
          },
          deliveryOptions: [
            ...(detail.setting.delivery_deliver !== "N" ? ["direct"] : []),
            ...(detail.setting.delivery_pickup === "Y" ? ["pickup"] : []),
            ...(detail.setting.delivery_parcel === "Y" ? ["parcel"] : []),
          ],
          items: detail.items
            .filter((i) => i.use_yn !== "N" && i.cat_gbn !== "CAT")
            .map((i) => ({
              id: i.seqno,
              name: i.iname,
              unit: i.unit,
              price: i.cost,
              stock: i.stock,
              image: Array.isArray(i.imageUrls) ? i.imageUrls[0] : "",
              description: text(i.detail_html).replace(/<[^>]*>/gu, ""),
              imageUrls:Array.isArray(i.imageUrls)?i.imageUrls:[],
              detailHtml:cleanHtml(i.detail_html),
              minQty:Number(i.item_min_qty??0),maxQty:Number(i.item_max_qty??0),
              stockVisible:i.stock_visible_gbn==='Y'&&Number(i.stock)<=Number(i.stock_visible_qty??0),stockVisibleQty:Number(i.stock_visible_qty??0),
              facts:Object.entries({origin_country:'원산지',livestock_trace_no:'축산물이력번호',content_amount:'내용량',expiry_info:'소비기한',storage_method:'보관방법',allergens:'알레르기',manufacturer:'제조사'}).filter(([key])=>text(i[key]??obj(i.fields)[key])).map(([key,label])=>({label,value:text(i[key]??obj(i.fields)[key])})),
            })),
        });
      }
      if(parts[2]==='quote')return success(await quoteOrder(c,Number(form.id),data));
      if (data.consent !== true)
        throw new LiveError(
          "주문 이행을 위한 개인정보 수집에 동의해 주세요.",
          422,
        );
      const fingerprint = await scopedFingerprint(
        request,
        `live-order:${token}:${text(data.mobile ?? data.phone)}`,
      );
      const gate = await db
        .prepare(
          "INSERT INTO of_submissions(fingerprint,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM of_submissions WHERE fingerprint=? AND created_at>?)<30",
        )
        .bind(
          fingerprint,
          now(),
          fingerprint,
          new Date(Date.now() - 60000).toISOString(),
        )
        .run();
      if (!gate.meta.changes)
        throw new LiveError(
          "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
          429,
        );
      return success(await createLiveOrder(c, Number(form.id), data));
    }
    if (parts[0] === "receipt") {
      const key = parts[1];
      if (!/^[a-f\d-]{36}$/u.test(key))
        throw new LiveError("유효하지 않은 주문 확인 링크입니다.", 404);
      const order = await db
        .prepare(
          "SELECT o.*,s.name shop_name FROM of_orders o JOIN of_shops s ON s.id=o.shop WHERE o.key=?",
        )
        .bind(key)
        .first<Doc>();
      if (!order) throw new LiveError("주문을 찾을 수 없습니다.", 404);
      const c: LiveContext = {
        db,
        shop: String(order.shop),
        actor: "customer",
        role: "CUSTOMER",
        permissions: {},
        origin: url.origin,
      };
      if (request.method === "POST") {
        const room = await openCustomerRoom(c, key);
        return success({ url: `/contact/${room.token}` });
      }
      const items = await db
        .prepare(
          "SELECT name,unit,quantity,price FROM of_order_items WHERE order_id=?",
        )
        .bind(order.id)
        .all();
      return success({
        orderNo: order.id,
        status: order.status,
        ispaid: order.ispaid,
        total: amountDue({...order,data:parse(order.data)}),
        shopName: order.shop_name,
        createdAt: order.created_at,
        items: items.results,
      });
    }
    if (parts[0] === "chat") {
      const {
        c,
        id,
        data: room,
      } = await publicChatContext(db, parts[1], url.origin);
      if(isUpload){
        const fingerprint=await scopedFingerprint(request,`chat-upload:${id}`);
        const gate=await db.prepare('INSERT INTO of_submissions(fingerprint,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM of_submissions WHERE fingerprint=? AND created_at>?)<10').bind(fingerprint,now(),fingerprint,new Date(Date.now()-60000).toISOString()).run();
        if(!gate.meta.changes)throw new LiveError('첨부 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
        if(room.status==='C')throw new LiveError('종료된 채팅방입니다.',409);
        return success(await upload(c,request));
      }
      if (request.method === "POST")
        return success(
          await send(c, id, data, "C"),
        );
      return success({
        room: {
          id,
          status: room.status,
          shopName: (
            await db
              .prepare("SELECT name FROM of_shops WHERE id=?")
              .bind(c.shop)
              .first<Doc>()
          )?.name,
        },
        messages: await messages(c, id),
      });
    }
    if (parts[0] === "dispatch") {
      const record = await db
        .prepare(
          "SELECT * FROM of_records WHERE kind='delivery-plan' AND deleted=0 AND json_extract(data,'$.shareToken')=?",
        )
        .bind(parts[1])
        .first<Doc>();
      const plan:Doc = {...parse(record?.data),planNo:parse(record?.data).planNo??record?.id};
      if (!record || text(plan.expiresAt) < now())
        throw new LiveError("배송 링크가 만료됐습니다.", 410);
      if (request.method === "POST") {
        const stops = Array.isArray(plan.stops) ? plan.stops.map(obj) : [];
        const index = stops.findIndex((s) => s.stopCode === data.stopCode);
        if (index < 0) throw new LiveError("배송지를 찾을 수 없습니다.", 404);
        const completedKeys=Array.isArray(stops[index].ocodekeys)?stops[index].ocodekeys:[stops[index].stopCode];
        if (stops[index].stopStatus === "30") return success(plan);
        stops[index] = { ...stops[index], stopStatus: "30", finishedAt: now() };
        const next = {
          ...plan,
          stops,
          doneStopCnt: stops.filter((s) => s.stopStatus === "30").length,
          planStatus: stops.every((s) => s.stopStatus === "30") ? "30" : "20",
        };
        const c: LiveContext = {
          db,
          shop: String(record.shop),
          actor: "driver",
          role: "DRIVER",
          permissions: {},
          origin: url.origin,
        };
        await transaction(
          c,
          [
            db
              .prepare(
                "UPDATE of_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND shop=?",
              )
              .bind(JSON.stringify(next), now(), record.id, record.shop),
            db
              .prepare(
                "UPDATE of_orders SET status='30',revision=revision+1,updated_at=? WHERE shop=? AND status<>'40' AND (key IN (SELECT value FROM json_each(?)) OR merged_into IN (SELECT id FROM of_orders WHERE shop=? AND key IN (SELECT value FROM json_each(?))))",
              )
              .bind(
                now(),
                record.shop,
                JSON.stringify(completedKeys),
                record.shop,
                JSON.stringify(completedKeys),
              ),
          ],
          [
            {
              sql: "EXISTS(SELECT 1 FROM of_records WHERE id=? AND revision=?)",
              values: [record.id, record.revision],
            },
          ],
        );
        return success(next);
      }
      return success(plan);
    }
    throw new LiveError("경로를 찾을 수 없습니다.", 404);
  } catch (error) {
    return failure(error);
  }
}
