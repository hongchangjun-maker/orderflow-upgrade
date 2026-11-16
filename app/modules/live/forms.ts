import { integer, itemOf, LiveError, obj, rows, text, type Doc } from "./domain";
import { cleanHtml } from "./html";
import { validateFeeRule } from "./fee-service";
import { deliveryFee,regionMatch } from "./pricing";
import { catalogActive, catalogHub, catalogImportRange } from "./catalog-rules";
const feeView=(r:Doc)=>({feeName:'',feeGbn:'FORCE',deliveryTip:0,minAmt:0,minAmtMessage:'',useGbn:'Y',...r,feeNo:r.id??r.feeNo,amtArr:Array.isArray(r.amtArr)?r.amtArr:[null,null,null],tipArr:Array.isArray(r.tipArr)?r.tipArr:[null,null,null],regionRows:rows(r.regionRows).map((v,index)=>({...v,sortNo:v.sortNo??index+1}))});
import {
  audit,
  first,
  list,
  now,
  parse,
  put,
  query,
  remove,
  setting,
  transaction,
  type LiveContext,
} from "./store";
export async function formDetail(
  c: LiveContext,
  id: number,
): Promise<{
  setting: Doc;
  items: Doc[];
  payMethods: Doc[];
  deliveryMethods: Doc[];
}> {
  const form = await first(
    c,
    "SELECT * FROM of_forms WHERE shop=? AND id=?",
    c.shop,
    id,
  );
  if (!form) throw new LiveError("주문서를 찾을 수 없습니다.", 404);
  const data = parse(form.data);
  const items = await query(
    c,
    "SELECT * FROM of_items WHERE shop=? AND form_id=? AND active=1 ORDER BY COALESCE(CAST(json_extract(data,'$.sort_index') AS INTEGER),id),id",
    c.shop,
    id,
  );
  return {
    setting: {
      ...data,
      use_gbn: form.active ? "Y" : "N",
      uocode: id,
      token: form.token,
      url: `${c.origin}/buy/${form.token}`,
      revision: form.revision,
      update_date: form.updated_at,
    },
    items: items.map((r) => ({
      ...parse(r.data),
      seqno: r.id,
      cost: r.price,
      stock: r.stock,
      update_date: String(r.revision),
    })),
    payMethods: rows(data.payMethods).length
      ? rows(data.payMethods)
      : [
          { seqno: 1, pay_name: "계좌이체", use_gbn: "Y", sort_gbn: 1 },
          { seqno: 2, pay_name: "매장결제", use_gbn: "Y", sort_gbn: 2 },
          { seqno: 3, pay_name: "선결제", use_gbn: "N", sort_gbn: 3 },
          { seqno: 4, pay_name: "체크·신용카드", use_gbn: "N", sort_gbn: 4 },
        ],
    deliveryMethods: rows(data.deliveryMethods).length
      ? rows(data.deliveryMethods)
      : [
          {
            seqno: 1,
            delivery_name: "직배송",
            use_gbn: "Y",
            amt: Number(data.shipping_fee ?? 0),
          },
          { seqno: 2, delivery_name: "픽업", use_gbn: "Y", amt: 0 },
        ],
  };
}
export async function formList(c: LiveContext) {
  const forms = await query(
    c,
    "SELECT f.*,COUNT(DISTINCT COALESCE(o.merged_into,o.id)) order_count,COALESCE(SUM(o.amount+o.fee-COALESCE(json_extract(o.data,'$.point_used'),0)+COALESCE(json_extract(o.data,'$.adjustment'),0)),0) sales FROM of_forms f LEFT JOIN of_orders o ON o.form_id=f.id AND o.status<>'40' WHERE f.shop=? GROUP BY f.id ORDER BY f.id DESC LIMIT 2000",
    c.shop,
  );
  return forms.map((f) => ({
    ...parse(f.data),
    uocode: f.id,
    token: f.token,
    url: `${c.origin}/buy/${f.token}`,
    uname: text(parse(f.data).title ?? parse(f.data).uname) || `주문서 ${f.id}`,
    order_title: text(parse(f.data).title ?? parse(f.data).uname),
    revision: f.revision,
    order_cnt: f.order_count,
    tamt: f.sales,
    url_gbn: text(parse(f.data).url_gbn) || "V3",
    use_gbn: f.active ? "Y" : "N",
    created_at: f.created_at,
    update_date: f.updated_at,
  }));
}
export async function saveForm(c: LiveContext, data: Doc, id = 0) {
  const items = rows(data.items);
  if (items.length > 100)
    throw new LiveError("한 주문서의 품목은 최대 100종입니다.", 422);
  const clean: Doc = {
    ...data,
    title:
      text(data.title ?? data.uname ?? data.order_title, 200) || "새 주문서",
  };
  delete clean.items;
  for (const field of ["notice", "contents", "detail_html"])
    if (clean[field] != null) clean[field] = cleanHtml(clean[field]);
  const time = now(),
    key =
      id || parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 12), 16);
  const statements: D1PreparedStatement[] = [],
    checks: Array<{
      sql: string;
      values: unknown[];
    }> = [];
  if (!id)
    statements.push(
      c.db
        .prepare(
          "INSERT INTO of_forms(id,shop,token,data,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          key,
          c.shop,
          crypto.randomUUID().replaceAll("-", ""),
          JSON.stringify(clean),
          catalogActive(data.use_gbn),
          time,
          time,
        ),
    );
  else {
    const old = await first(
      c,
      "SELECT * FROM of_forms WHERE shop=? AND id=?",
      c.shop,
      key,
    );
    if (!old) throw new LiveError("주문서를 찾을 수 없습니다.", 404);
    const revision = data.revision ?? old.revision;
    checks.push({
      sql: "EXISTS(SELECT 1 FROM of_forms WHERE id=? AND shop=? AND revision=?)",
      values: [key, c.shop, revision],
    });
    statements.push(
      c.db
        .prepare(
          "UPDATE of_forms SET data=?,revision=revision+1,updated_at=?,active=? WHERE shop=? AND id=?",
        )
        .bind(
          JSON.stringify(clean),
          time,
          catalogActive(data.use_gbn),
          c.shop,
          key,
        ),
    );
  }
  statements.push(
    c.db
      .prepare("UPDATE of_items SET active=0 WHERE shop=? AND form_id=?")
      .bind(c.shop, key),
  );
  for (const [position, raw] of items.entries()) {
    const item = itemOf(raw);
    item.sort_index = position;
    if (item.detail_html != null)
      item.detail_html = cleanHtml(item.detail_html);
    const existing = Number(raw.seqno ?? 0);
    if (existing > 0 && id) {
      const own = await first(
        c,
        "SELECT id,revision FROM of_items WHERE id=? AND shop=? AND form_id=?",
        existing,
        c.shop,
        key,
      );
      if (!own)
        throw new LiveError("다른 주문서의 품목을 사용할 수 없습니다.", 403);
      checks.push({
        sql: "EXISTS(SELECT 1 FROM of_items WHERE id=? AND shop=? AND revision=?)",
        values: [existing, c.shop, raw.update_date ?? own.revision],
      });
      statements.push(
        c.db
          .prepare(
            "UPDATE of_items SET data=?,price=?,stock=?,active=1,revision=revision+1 WHERE id=? AND shop=? AND form_id=?",
          )
          .bind(
            JSON.stringify(item),
            item.cost,
            item.stock,
            existing,
            c.shop,
            key,
          ),
      );
    } else
      statements.push(
        c.db
          .prepare(
            "INSERT INTO of_items(shop,form_id,data,price,stock) VALUES(?,?,?,?,?)",
          )
          .bind(c.shop, key, JSON.stringify(item), item.cost, item.stock),
      );
  }
  await transaction(c, statements, checks);
  await audit(c, "form", key);
  return { int_value1: key, uocode: key, ...(await formDetail(c, key)) };
}
export async function formsApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/urlorders/list" || path === "/orders/url-orders") {
    const all = await formList(c),
      size = Math.min(2000, Math.max(1, Number(data.pageSize ?? 2000))),
      page = Math.max(0, Number(data.pageIndex ?? 0));
    return all.slice(page * size, (page + 1) * size);
  }
  if (path === "/urlorder-v2/hub") {
    return catalogHub(await formList(c), data);
  }
  if (/^\/urlorders\/setting(?:\/\d+)?$/u.test(path)) {
    const id = Number(path.split("/")[3] ?? 0);
    return method === "GET" ? formDetail(c, id) : saveForm(c, data, id);
  }
  if (path === "/urlorder-v2/ui-mark") {
    const id = integer(data.uocode, 1, Number.MAX_SAFE_INTEGER);
    const detail = await formDetail(c, id);
    return saveForm(
      c,
      {
        ...detail.setting,
        ...data,
        url_gbn: data.ui,
        items: detail.items,
        payMethods: detail.payMethods,
        deliveryMethods: detail.deliveryMethods,
      },
      id,
    );
  }
  if (path.startsWith("/urlorders/setting/")) {
    const suffix = path.split("/").at(-1);
    let id = Number(data.uocode ?? data.formId ?? 0);
    if (suffix === "item-import") {
      const range = catalogImportRange(data.from_date, data.to_date);
      return (
        await query(
          c,
          "SELECT i.* FROM of_items i JOIN of_forms f ON f.id=i.form_id AND f.shop=i.shop WHERE i.shop=? AND i.active=1 AND REPLACE(COALESCE(NULLIF(json_extract(f.data,'$.order_date'),''),strftime('%Y%m%d',f.created_at,'+9 hours')),'-','') BETWEEN ? AND ? ORDER BY f.id DESC,COALESCE(CAST(json_extract(i.data,'$.sort_index') AS INTEGER),i.id),i.id LIMIT 2000",
          c.shop,
          range.from,
          range.to,
        )
      ).map((r) => ({
        ...parse(r.data),
        seqno: 0,
        stock: r.stock,
        cost: r.price,
      }));
    }
    if (suffix === "item-images") {
      const items = (
        await formDetail(c, integer(id, 1, Number.MAX_SAFE_INTEGER))
      ).items;
      return {
        urls: Object.fromEntries(
          items.map((i) => [
            String(i.seqno),
            Array.isArray(i.imageUrls) ? i.imageUrls : [],
          ]),
        ),
        fcodekeys: Object.fromEntries(
          items.map((i) => [
            String(i.seqno),
            Array.isArray(i.fcodekeys) ? i.fcodekeys : [],
          ]),
        ),
      };
    }
    if (suffix === "use-item-detail-save") {
      await c.db
        .prepare(
          "UPDATE of_forms SET data=json_set(data,'$.use_item_detail',?),revision=revision+1 WHERE id=? AND shop=?",
        )
        .bind(data.use_item_detail, id, c.shop)
        .run();
      return { affected: 1 };
    }
    if (suffix === "save-orderitem") {
      if (!id) {
        const matching = (await formList(c)).filter(
          (f) => f["order_date" as keyof typeof f] === data.order_date,
        );
        if (matching.length !== 1)
          throw new LiveError("주문서를 하나 선택해 주세요.", 422);
        id = Number(matching[0].uocode);
      }
      const detail = await formDetail(c, id);
      return saveForm(
        c,
        {
          ...detail.setting,
          items: rows(data.items),
          payMethods: detail.payMethods,
          deliveryMethods: detail.deliveryMethods,
        },
        id,
      );
    }
    const seq = integer(data.seqno ?? data.itemSeqno ?? data.item_seqno, 1);
    const row = await first(
      c,
      "SELECT * FROM of_items WHERE id=? AND shop=?",
      seq,
      c.shop,
    );
    if (!row) throw new LiveError("품목을 찾을 수 없습니다.", 404);
    if (suffix?.endsWith("get") || suffix === "item-images")
      return {
        ...parse(row.data),
        images: parse(row.data).images ?? [],
        seqno: seq,
        uocode: row.form_id,
        cost: row.price,
        stock: row.stock,
        update_date: String(row.revision),
      };
    const item = itemOf({ ...parse(row.data), ...data });
    if (item.sort_index != null)
      item.sort_index = integer(item.sort_index, 0, 999999);
    if (item.detail_html != null)
      item.detail_html = cleanHtml(item.detail_html);
    // Retain the database stock, not a stale stock value inside JSON.
    item.stock = integer(data.stock ?? row.stock, 0, 999999);
    if (suffix === "item-images-save") {
      const keys = Array.isArray(data.fcodekeys)
        ? data.fcodekeys
        : Array.isArray(data.images)
          ? data.images
          : [];
      const available = await list(c, "image");
      item.fcodekeys = keys;
      item.imageUrls = keys
        .map(
          (key) =>
            available.find((r) => r.fcodekey === key || r.id === Number(key))
              ?.file_name_thumb,
        )
        .filter(Boolean);
    }
    const result = await c.db
      .prepare(
        "UPDATE of_items SET data=?,price=?,stock=?,revision=revision+1 WHERE id=? AND shop=? AND revision=?",
      )
      .bind(
        JSON.stringify(item),
        item.cost,
        item.stock,
        seq,
        c.shop,
        data.update_date ?? row.revision,
      )
      .run();
    if (!result.meta.changes) {
      const current = await first(
        c,
        "SELECT revision,stock,price FROM of_items WHERE id=? AND shop=?",
        seq,
        c.shop,
      );
      throw new LiveError(
        "품목이 변경됐습니다. 현재 재고와 가격을 확인해 주세요.",
        409,
        "revision_conflict",
        {
          update_date: String(current?.revision ?? row.revision),
          stock: current?.stock ?? row.stock,
          cost: current?.price ?? row.price,
        },
      );
    }
    await audit(c, "item", seq);
    return {
      ...item,
      seqno: seq,
      urls: item.imageUrls ?? [],
      affected: 1,
      update_date: String(Number(row.revision) + 1),
    };
  }
  if (path === "/badges" || path === "/badges/items") {
    if (method === "GET") return list(c, "badge");
    return put(c, "badge", data, Number(data.seqno ?? 0));
  }
  if(path==='/delivery-fee/fees/preview-address'){
    const rule={...data,feeGbn:'REGION'},match=regionMatch(rule,text(data.address));
    const deny=match?.deny===true||!match&&data.otherDeny===true;
    return {matched:match?{sortNo:match.sortNo,matchedKeyword:match.keyword}:null,deny,amt:deny?0:deliveryFee({},0,'direct',text(data.address),rule),sellerAmt:deny?Number(match?.amt??data.deliveryTip??0):null};
  }
  if(/^\/delivery-fee\/fees\/\d+\/disable$/u.test(path)){
    const id=Number(path.split('/')[3]),old=(await list(c,'delivery-fee')).find(f=>Number(f.id)===id);
    if(!old)throw new LiveError('배송비 설정을 찾을 수 없습니다.',404);
    return put(c,'delivery-fee',{...old,useGbn:'N'},id);
  }
  if(/^\/delivery-fee\/fees\/\d+$/u.test(path)&&method==='DELETE')return remove(c,'delivery-fee',Number(path.split('/')[3]));
  if (path === "/delivery-fee/fees" || path === "/delivery-fee/shop-city") {
    if (method === "GET") {
      const settings=parse((await first(c,'SELECT settings FROM of_shops WHERE id=?',c.shop))?.settings);
      return (await list(c,"delivery-fee")).map((r,index)=>({...feeView(r),sortNo:r.sortNo??index,builtin:false,linkUrlorderCnt:Object.entries(settings).filter(([key,value])=>key.startsWith('/delivery-fee/urlorder/')&&[obj(value).feeNoDeliver,obj(value).feeNoPickup,obj(value).feeNoParcel,...rows(obj(value).rows).map(v=>v.feeNo)].some(n=>Number(n)===Number(r.id))).length,linkRowCnt:Object.entries(settings).filter(([key,value])=>key.startsWith('/delivery-fee/deliverygbn/')&&Number(obj(value).feeNo)===Number(r.id)).length}));
    }
    const id=Number(data.feeNo??data.seqno??0);
    const result=await put(c,"delivery-fee",validateFeeRule(feeView({...data,feeNo:id||undefined})),id);
    return {...result,feeNo:result.id??result.seqno};
  }
  if(/^\/delivery-fee\/urlorder\/\d+\/link$/u.test(path)){
    const id=Number(path.split('/')[3]),detail=await formDetail(c,id);
    const value=await setting(c,path,method==='GET'?undefined:data);
    const all=parse((await first(c,'SELECT settings FROM of_shops WHERE id=?',c.shop))?.settings);
    const linked=detail.deliveryMethods.map(m=>{const override=all[`/delivery-fee/deliverygbn/${m.seqno}/link`] as Doc|undefined;return {seqno:m.seqno,feeNo:override&&(!override.uocode||Number(override.uocode)===id)?override.feeNo??null:rows(value.rows).find(r=>Number(r.seqno)===Number(m.seqno))?.feeNo??null};});
    return {uocode:id,feeNoDeliver:null,feeNoPickup:null,feeNoParcel:null,sameDayMerge:false,mergeNotice:'',...value,rows:linked.filter(r=>r.feeNo!=null)};
  }
  if (path.startsWith("/delivery-fee/"))
    return setting(c, path, method === "GET" ? undefined : data);
  return undefined;
}
