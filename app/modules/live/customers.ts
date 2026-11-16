import {
  integer,
  LiveError,
  mobileOf,
  obj,
  required,
  text,
  type Doc,
} from "./domain";
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
  type LiveContext,
} from "./store";
import {
  kstCreatedBounds,
  reportMonth,
  reportPage,
  reportRange,
} from "./report-rules";
const POINT = (alias: string) =>
  `COALESCE(json_extract(${alias}.data,'$.point_used'),json_extract(${alias}.data,'$.point'),0)`;
const NET = (alias: string) =>
  `(${alias}.amount+${alias}.fee-${POINT(alias)}+COALESCE(json_extract(${alias}.data,'$.adjustment'),0))`;
const REQUESTED = (alias: string) =>
  `(CASE WHEN json_type(${alias}.data,'$.cash_receipt_requested') IS NOT NULL THEN json_extract(${alias}.data,'$.cash_receipt_requested') IN (1,'1','Y','true') ELSE (COALESCE(json_extract(${alias}.data,'$.iscashreceipt'),'N') NOT IN ('N','0',0,'','false') OR COALESCE(json_extract(${alias}.data,'$.cash_receipt'),'N') NOT IN ('N','0',0,'','false')) END)`;
const ISSUED = (alias: string) =>
  `(COALESCE(json_extract(${alias}.data,'$.cash_receipt_issued'),0) IN (1,'1','Y') OR json_extract(${alias}.data,'$.cash_receipt_status')='issued')`;
const searchOf = (data: Doc) =>
  text(data.search ?? data.searchData ?? data.keyword).toLowerCase();
const paidClause = (data: Doc, alias = "o") =>
  data.paid === "paid" || data.paid === "Y"
    ? ` AND ${alias}.ispaid='Y'`
    : data.paid === "unpaid" || data.paid === "N"
      ? ` AND ${alias}.ispaid='N'`
      : "";
export async function customerRows(c: LiveContext, filter: Doc = {}) {
  const range = reportRange(filter),
    page = reportPage(filter),
    search = searchOf(filter),
    mobile = text(filter.mobile);
  const result = await query(
    c,
    `SELECT c.*,COUNT(DISTINCT CASE WHEN o.status<>'40' THEN COALESCE(o.merged_into,o.id) END) order_qty,COALESCE(SUM(CASE WHEN o.status<>'40' THEN ${NET("o")} ELSE 0 END),0) order_amt,MAX(CASE WHEN o.status<>'40' THEN o.created_at END) last_order_date,COALESCE(l.prepay,0) remain_amt,COALESCE(l.point,0) remain_point FROM of_customers c LEFT JOIN of_orders o ON o.customer_id=c.id AND o.shop=c.shop AND o.order_date BETWEEN ? AND ? LEFT JOIN (SELECT mobile,SUM(CASE WHEN kind='prepay' THEN delta ELSE 0 END) prepay,SUM(CASE WHEN kind='point' THEN delta ELSE 0 END) point FROM of_ledger WHERE shop=? GROUP BY mobile) l ON l.mobile=c.mobile WHERE c.shop=? AND (?='' OR instr(lower(c.name||' '||c.mobile||' '||COALESCE(json_extract(c.data,'$.addr'),'')),?)>0) AND (?='' OR c.mobile=?) GROUP BY c.id ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    range.from,
    range.to,
    c.shop,
    c.shop,
    search,
    search,
    mobile,
    mobile,
    page.limit,
    page.offset,
  );
  return result.map((r) => ({
    ...parse(r.data),
    seqno: r.id,
    cust_name: r.name,
    name: r.name,
    mobile: r.mobile,
    order_qty: r.order_qty,
    order_amt: r.order_amt,
    last_order_date: r.last_order_date,
    isrt_date: r.created_at,
    duof_isrt: Math.floor(
      (Date.now() - Date.parse(String(r.created_at))) / 86400000,
    ),
    duof_order: r.last_order_date
      ? Math.floor(
          (Date.now() - Date.parse(String(r.last_order_date))) / 86400000,
        )
      : 0,
    remain_amt: Number(r.remain_amt),
    remain_point: Number(r.remain_point),
  }));
}
async function monthlySales(c: LiveContext, data: Doc) {
  const range = reportMonth(data),
    search = searchOf(data),
    page = reportPage(data);
  const bills = `SELECT o.customer_id,COALESCE(o.merged_into,o.id) bill_id,SUM(${NET("o")}) bill_total,MAX(CASE WHEN ${REQUESTED("o")} THEN 1 ELSE 0 END) requested,MAX(CASE WHEN ${ISSUED("o")} THEN 1 ELSE 0 END) issued FROM of_orders o WHERE o.shop=? AND o.order_date BETWEEN ? AND ? AND o.status<>'40'${paidClause(data)} GROUP BY COALESCE(o.merged_into,o.id)`;
  const base = `SELECT c.id,c.name cust_name,c.mobile,COUNT(*) order_count,SUM(b.bill_total) total_amount,MAX(b.requested) cash_receipt_requested,SUM(CASE WHEN b.issued=1 THEN 1 ELSE 0 END) issued_count,SUM(CASE WHEN b.requested=1 AND b.issued=0 THEN 1 ELSE 0 END) unissued_count,SUM(CASE WHEN b.requested=1 AND b.issued=0 THEN b.bill_total ELSE 0 END) unissued_amount FROM (${bills}) b JOIN of_customers c ON c.id=b.customer_id WHERE c.shop=? AND (?='' OR instr(lower(c.name||' '||c.mobile),?)>0) GROUP BY c.id`;
  const values = [c.shop, range.from, range.to, c.shop, search, search];
  const condition =
    data.filter === "req_only"
      ? "cash_receipt_requested=1"
      : data.filter === "unissued_only"
        ? "unissued_count>0"
        : "1=1";
  const [customers, kpi, total] = await Promise.all([
    query(
      c,
      `SELECT * FROM (${base}) r WHERE ${condition} ORDER BY total_amount DESC,id LIMIT ? OFFSET ?`,
      ...values,
      page.limit,
      page.offset,
    ),
    first(
      c,
      `SELECT COUNT(*) totalCustomers,COALESCE(SUM(cash_receipt_requested=1),0) reqCustomers,COALESCE(SUM(unissued_count),0) totalUnissued,COALESCE(SUM(unissued_amount),0) totalUnissuedAmount,COALESCE(SUM(issued_count),0) totalIssued,COALESCE(SUM(total_amount),0) totalAmountAll FROM (${base}) r`,
      ...values,
    ),
    first(
      c,
      `SELECT COUNT(*) n FROM (${base}) r WHERE ${condition}`,
      ...values,
    ),
  ]);
  return {
    customers: customers.map((r, index) => ({
      ...r,
      rank: page.offset + index + 1,
      cash_receipt_requested: Number(r.cash_receipt_requested) > 0,
    })),
    kpi,
    totalCnt: Number(total?.n ?? 0),
    pageIndex: page.pageIndex,
    pageSize: page.limit,
    hasMore: page.offset + customers.length < Number(total?.n ?? 0),
    yyyymm: range.month,
  };
}
async function customerOrders(c: LiveContext, data: Doc, bulk = false) {
  const range = reportMonth(data),
    page = reportPage(data, 500),
    mobiles = bulk
      ? Array.isArray(data.mobiles)
        ? data.mobiles
        : Array.isArray(data.mobile_arr)
          ? data.mobile_arr
          : text(data.mobile_arr).split(",")
      : [data.mobile];
  const chosen = [
    ...new Set(mobiles.map((v) => text(v).replace(/\D/gu, "")).filter(Boolean)),
  ];
  if (chosen.length > 100)
    throw new LiveError("한 번에 고객 100명 이하를 선택해 주세요.", 422);
  if (!chosen.length) return bulk ? { ordersByMobile: {} } : { orders: [] };
  const orders = await query(
    c,
    `SELECT p.*,cu.mobile,cu.name cust_name,COALESCE(json_extract(f.data,'$.urlorderno'),p.form_id) urlorderno,SUM(${NET("o")}) tamt,SUM(o.amount) bill_amount,SUM(o.fee) bill_fee,MAX(CASE WHEN ${REQUESTED("o")} THEN 1 ELSE 0 END) bill_requested,MAX(CASE WHEN ${ISSUED("o")} THEN 1 ELSE 0 END) bill_issued FROM of_orders p JOIN of_customers cu ON cu.id=p.customer_id JOIN of_forms f ON f.id=p.form_id JOIN of_orders o ON o.shop=p.shop AND (o.id=p.id OR o.merged_into=p.id) WHERE p.shop=? AND p.merged_into IS NULL AND p.order_date BETWEEN ? AND ? AND p.status<>'40' AND cu.mobile IN (SELECT value FROM json_each(?))${paidClause(data, "p")} GROUP BY p.id${data.onlyUnissued === true ? " HAVING bill_requested=1 AND bill_issued=0" : ""} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    c.shop,
    range.from,
    range.to,
    JSON.stringify(chosen),
    page.limit,
    page.offset,
  );
  const ids = JSON.stringify(orders.map((o) => o.id));
  const items = await query(
    c,
    "SELECT i.*,COALESCE(o.merged_into,o.id) bill_id FROM of_order_items i JOIN of_orders o ON o.id=i.order_id WHERE o.shop=? AND COALESCE(o.merged_into,o.id) IN (SELECT value FROM json_each(?)) ORDER BY i.id",
    c.shop,
    ids,
  );
  const projected = orders.map((o) => ({
    ...parse(o.data),
    ocodekey: o.key,
    ocode: o.id,
    orderno: o.id,
    urlorderno: o.urlorderno,
    cust_name: o.cust_name,
    mobile: o.mobile,
    orderDate: o.order_date,
    order_date: o.order_date,
    status: o.status,
    ispaid: o.ispaid,
    tamt: Number(o.tamt),
    order_amt: Number(o.bill_amount),
    delivery_amt: Number(o.bill_fee),
    cash_receipt_requested: Number(o.bill_requested) > 0,
    cash_receipt_issued: Number(o.bill_issued) > 0,
    itemSummary: items
      .filter((i) => Number(i.bill_id) === Number(o.id))
      .map((i) => `${i.name} ${i.quantity}${i.unit}`)
      .join(", "),
  }));
  if (bulk)
    return {
      ordersByMobile: Object.fromEntries(
        chosen.map((mobile) => [
          mobile,
          projected.filter((o) => o.mobile === mobile),
        ]),
      ),
      pageIndex: page.pageIndex,
      pageSize: page.limit,
    };
  return { orders: projected, pageIndex: page.pageIndex, pageSize: page.limit };
}
async function customerItems(c: LiveContext, data: Doc) {
  const range = reportRange(data),
    page = reportPage(data),
    mobile = text(data.mobile).replace(/\D/gu, "");
  if (!mobile) return [];
  return (
    await query(
      c,
      `SELECT i.*,p.id ocode,p.key ocodekey,p.order_date,p.status,p.data,(SELECT SUM(${NET("m")}) FROM of_orders m WHERE m.shop=p.shop AND (m.id=p.id OR m.merged_into=p.id)) tamt FROM of_order_items i JOIN of_orders o ON o.id=i.order_id JOIN of_orders p ON p.id=COALESCE(o.merged_into,o.id) JOIN of_customers cu ON cu.id=p.customer_id WHERE p.shop=? AND cu.mobile=? AND p.order_date BETWEEN ? AND ? ORDER BY p.id DESC,i.id LIMIT ? OFFSET ?`,
      c.shop,
      mobile,
      range.from,
      range.to,
      page.limit,
      page.offset,
    )
  ).map((r) => ({
    ...parse(r.data),
    ocodekey: r.ocodekey,
    ocode: r.ocode,
    order_date: r.order_date,
    status: r.status,
    tamt: r.tamt,
    seqno: r.id,
    item_id: r.item_id,
    iname: r.name,
    unit: r.unit,
    cost: r.price,
    price: r.price,
    qty: r.quantity,
    amt: Number(r.price) * Number(r.quantity),
  }));
}
export async function ledger(c: LiveContext, data: Doc, kind = "point") {
  const mobile = mobileOf(data.mobile);
  const delta = integer(
    Math.abs(Number(data.delta ?? data.amt ?? data.point)),
    1,
  );
  const signed =
    Number(data.delta ?? data.amt ?? data.point) < 0 ? -delta : delta;
  const operation = required(
    data.operation ?? data.idempotencyKey,
    "처리 식별자",
    120,
  );
  const memo = required(data.memo ?? "관리자 수동 조정", "처리 사유", 300);
  const old = await first(
    c,
    "SELECT * FROM of_ledger WHERE shop=? AND operation=?",
    c.shop,
    operation,
  );
  if (old) {
    if (
      old.mobile !== mobile ||
      old.kind !== kind ||
      Number(old.delta) !== signed
    )
      throw new LiveError("처리 식별자가 다른 거래에 사용되었습니다.", 409);
    return { id: old.id, replayed: true };
  }
  let result: D1Result;
  try {
    result = await c.db
      .prepare(
        "INSERT INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(c.shop, mobile, kind, signed, memo, operation, c.actor, now())
      .run();
  } catch (error) {
    const raced = await first(
      c,
      "SELECT id,mobile,kind,delta FROM of_ledger WHERE shop=? AND operation=?",
      c.shop,
      operation,
    );
    if (
      raced &&
      raced.mobile === mobile &&
      raced.kind === kind &&
      Number(raced.delta) === signed
    )
      return { id: raced.id, replayed: true };
    throw error;
  }
  await audit(c, "ledger", result.meta.last_row_id);
  return { id: result.meta.last_row_id };
}
export async function customersApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/customers/search" || path === "/customers/book") {
    return customerRows(c, data);
  }
  if (path === "/customers/stats") {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
      .format(new Date())
      .replaceAll("-", "");
    const bounds = kstCreatedBounds(today, today);
    const stats = await first(
      c,
      `SELECT COUNT(*) total,COALESCE(SUM(c.created_at>=? AND c.created_at<?),0) new,COALESCE(SUM(COALESCE(o.amt,0)>1000000),0) vip FROM of_customers c LEFT JOIN (SELECT customer_id,SUM(${NET("o")}) amt FROM of_orders o WHERE shop=? AND status<>'40' GROUP BY customer_id) o ON o.customer_id=c.id WHERE c.shop=?`,
      bounds.from,
      bounds.to,
      c.shop,
      c.shop,
    );
    return stats ?? { total: 0, new: 0, vip: 0 };
  }
  if (path.includes("/point/history") || path.includes("/prepayment/history")) {
    const kind = path.includes("point") ? "point" : "prepay";
    const range = reportRange(data),
      bounds = kstCreatedBounds(range.from, range.to),
      page = reportPage(data, 2000, 5000);
    return query(
      c,
      "SELECT l.*,l.delta amt,l.delta point,l.created_at isrt_date,cu.name cust_name FROM of_ledger l LEFT JOIN of_customers cu ON cu.shop=l.shop AND cu.mobile=l.mobile WHERE l.shop=? AND l.kind=? AND (?='' OR l.mobile=?) AND l.created_at>=? AND l.created_at<? ORDER BY l.id DESC LIMIT ? OFFSET ?",
      c.shop,
      kind,
      text(data.mobile),
      text(data.mobile),
      bounds.from,
      bounds.to,
      page.limit,
      page.offset,
    );
  }
  if (path.endsWith("/balance")) {
    const kind = path.includes("point") ? "point" : "prepay";
    const row = await first(
      c,
      "SELECT COALESCE(SUM(delta),0) balance FROM of_ledger WHERE shop=? AND mobile=? AND kind=?",
      c.shop,
      text(data.mobile),
      kind,
    );
    return {
      balance: Number(row?.balance ?? 0),
      remain_amt: Number(row?.balance ?? 0),
      remain_point: Number(row?.balance ?? 0),
    };
  }
  if (path === "/customers/ledger")
    return ledger(c, data, data.kind === "prepay" ? "prepay" : "point");
  if(path==='/customers/point/save'){
    if(!['적립','사용'].includes(text(data.io_gbn)))throw new LiveError('적립/사용 구분을 확인해 주세요.',422);
    const result=await ledger(c,{...data,delta:integer(data.amt,1)*(data.io_gbn==='사용'?-1:1)},'point');
    return {...result,error_no:0,error_msg:''};
  }
  if (path === "/customers/point/bulk-save") {
    let updated = 0;
    for (const entry of Array.isArray(data.items) ? data.items : []) {
      await ledger(c, obj(entry), "point");
      updated++;
    }
    return { updated };
  }
  if (path === "/customers/block/setting")
    return setting(c, "block-setting", method === "GET" ? undefined : data);
  if (path === "/customers/block/mobiles")
    return (await list(c, "customer-block")).map((r) => r.mobile);
  if (path === "/customers/block") {
    if (method === "GET") return list(c, "customer-block");
    return put(c, "customer-block", { ...data, mobile: mobileOf(data.mobile) });
  }
  if (path === "/customers/block/release") {
    const target = (await list(c, "customer-block")).find(
      (r) => r.mobile === data.mobile || r.id === data.seqno,
    );
    if (!target) throw new LiveError("차단 고객을 찾을 수 없습니다.", 404);
    return remove(c, "customer-block", Number(target.id));
  }
  if (path === "/customers/monthly-sales") {
    return monthlySales(c, data);
  }
  if (
    path === "/customers/month-orders" ||
    path === "/customers/month-orders/bulk"
  )
    return customerOrders(c, data, path.endsWith("/bulk"));
  if (path === "/customers/order-items") return customerItems(c, data);
  return undefined;
}
