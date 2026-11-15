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
export async function customerRows(c: LiveContext) {
  const result = await query(
    c,
    "SELECT c.*,COUNT(o.id) order_qty,COALESCE(SUM(CASE WHEN o.status<>'40' THEN o.amount+o.fee ELSE 0 END),0) order_amt,MAX(o.created_at) last_order_date FROM of_customers c LEFT JOIN of_orders o ON o.customer_id=c.id WHERE c.shop=? GROUP BY c.id ORDER BY c.id DESC LIMIT 5000",
    c.shop,
  );
  const balances = await query(
    c,
    "SELECT mobile,kind,SUM(delta) balance FROM of_ledger WHERE shop=? GROUP BY mobile,kind",
    c.shop,
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
    remain_amt: Number(
      balances.find((b) => b.mobile === r.mobile && b.kind === "prepay")
        ?.balance ?? 0,
    ),
    remain_point: Number(
      balances.find((b) => b.mobile === r.mobile && b.kind === "point")
        ?.balance ?? 0,
    ),
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
    const all = await customerRows(c);
    const search = text(data.search).toLowerCase();
    return all.filter(
      (r) =>
        !search || `${r.cust_name} ${r.mobile}`.toLowerCase().includes(search),
    );
  }
  if (path === "/customers/stats") {
    const all = await customerRows(c);
    return {
      total: all.length,
      new: all.filter((r) => r.duof_isrt === 0).length,
      vip: all.filter((r) => Number(r.order_amt) > 1000000).length,
    };
  }
  if (path.includes("/point/history") || path.includes("/prepayment/history")) {
    const kind = path.includes("point") ? "point" : "prepay";
    return query(
      c,
      "SELECT *,delta amt,delta point,created_at isrt_date FROM of_ledger WHERE shop=? AND kind=? AND (?='' OR mobile=?) ORDER BY id DESC LIMIT 2000",
      c.shop,
      kind,
      text(data.mobile),
      text(data.mobile),
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
    return customerRows(c);
  }
  if (
    path === "/customers/month-orders" ||
    path === "/customers/month-orders/bulk" ||
    path === "/customers/order-items"
  )
    return query(
      c,
      "SELECT o.* FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND cu.mobile=? ORDER BY o.id DESC LIMIT 500",
      c.shop,
      text(data.mobile),
    );
  return undefined;
}
