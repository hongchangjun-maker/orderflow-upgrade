import { day, text, type Doc } from "./domain";
import { first, query, type LiveContext } from "./store";
import {
  kstCreatedBounds,
  reportDay,
  reportRange,
  salesComparison,
  salesSeries,
  salesSeriesRange,
} from "./report-rules";

const POINT =
  "COALESCE(json_extract(o.data,'$.point_used'),json_extract(o.data,'$.point'),0)";
const ADJUST = "COALESCE(json_extract(o.data,'$.adjustment'),0)";
const NET = `(o.amount+o.fee-${POINT}+${ADJUST})`;
const BILL = "COALESCE(o.merged_into,o.id)";
const zero = {
  orderCnt: 0,
  itemSales: 0,
  fee: 0,
  pointDisc: 0,
  total: 0,
  adjust: 0,
  cancelCnt: 0,
  cancelAmt: 0,
  customers: 0,
  newCustomers: 0,
  returningCustomers: 0,
  avgPrice: 0,
};

async function aggregate(c: LiveContext, from: string, to: string) {
  const value = await first(
    c,
    `SELECT COUNT(DISTINCT CASE WHEN o.status<>'40' THEN ${BILL} END) orderCnt,COALESCE(SUM(CASE WHEN o.status<>'40' THEN o.amount ELSE 0 END),0) itemSales,COALESCE(SUM(CASE WHEN o.status<>'40' THEN o.fee ELSE 0 END),0) fee,COALESCE(SUM(CASE WHEN o.status<>'40' THEN ${POINT} ELSE 0 END),0) pointDisc,COALESCE(SUM(CASE WHEN o.status<>'40' THEN ${ADJUST} ELSE 0 END),0) adjust,COALESCE(SUM(CASE WHEN o.status<>'40' THEN ${NET} ELSE 0 END),0) total,COUNT(DISTINCT CASE WHEN o.status='40' THEN ${BILL} END) cancelCnt,COALESCE(SUM(CASE WHEN o.status='40' THEN ${NET} ELSE 0 END),0) cancelAmt,COUNT(DISTINCT CASE WHEN o.status<>'40' THEN o.customer_id END) customers FROM of_orders o WHERE o.shop=? AND o.order_date BETWEEN ? AND ?`,
    c.shop,
    from,
    to,
  );
  const fresh = await first(
    c,
    "SELECT COUNT(*) n FROM (SELECT customer_id,MIN(order_date) first_date FROM of_orders WHERE shop=? AND status<>'40' GROUP BY customer_id) WHERE first_date BETWEEN ? AND ?",
    c.shop,
    from,
    to,
  );
  return {
    ...zero,
    ...value,
    newCustomers: Number(fresh?.n ?? 0),
    returningCustomers: Number(value?.customers ?? 0) - Number(fresh?.n ?? 0),
    avgPrice: Number(value?.orderCnt)
      ? Math.round(Number(value?.itemSales) / Number(value?.orderCnt))
      : 0,
  };
}

async function dailyRows(c: LiveContext, from: string, to: string) {
  return query(
    c,
    `SELECT o.order_date date,COUNT(DISTINCT ${BILL}) orderCnt,COALESCE(SUM(o.amount),0) itemSales,COALESCE(SUM(o.fee),0) fee,COALESCE(SUM(${POINT}),0) pointDisc,COALESCE(SUM(${ADJUST}),0) adjust,COALESCE(SUM(${NET}),0) total FROM of_orders o WHERE o.shop=? AND o.status<>'40' AND o.order_date BETWEEN ? AND ? GROUP BY o.order_date ORDER BY o.order_date`,
    c.shop,
    from,
    to,
  );
}

export async function dashboardApi(
  c: LiveContext,
  path: string,
  data: Doc,
): Promise<unknown> {
  if (!path.startsWith("/dashboard/")) return undefined;
  const today = day();
  if (path === "/dashboard/today-summary")
    return (
      (await first(
        c,
        `SELECT COUNT(DISTINCT ${BILL}) today_order_count,COALESCE(SUM(CASE WHEN o.status<>'40' THEN ${NET} ELSE 0 END),0) today_sales_amount,COUNT(DISTINCT CASE WHEN o.status='00' THEN ${BILL} END) today_pending_count,COUNT(DISTINCT CASE WHEN o.status='24' THEN ${BILL} END) today_shipping_count FROM of_orders o WHERE o.shop=? AND o.order_date=?`,
        c.shop,
        today,
      )) ?? {}
    );
  if (path === "/dashboard/order-status") {
    const values = await query(
      c,
      `SELECT o.status,COUNT(DISTINCT ${BILL}) n FROM of_orders o WHERE o.shop=? AND o.order_date=? GROUP BY o.status`,
      c.shop,
      today,
    );
    return Object.fromEntries(
      [
        ["status_received", "10"],
        ["status_packing", "22"],
        ["status_shipping", "24"],
        ["status_completed", "30"],
      ].map(([key, status]) => [
        key,
        Number(values.find((r) => r.status === status)?.n ?? 0),
      ]),
    );
  }
  if (path === "/dashboard/pending-counts")
    return (
      (await first(
        c,
        `SELECT COUNT(DISTINCT CASE WHEN o.status='00' THEN ${BILL} END) unconfirmed,COUNT(DISTINCT CASE WHEN o.status IN ('00','10') THEN ${BILL} END) unpacked,COUNT(DISTINCT CASE WHEN o.status IN ('00','10','22') THEN ${BILL} END) unshipped,COUNT(DISTINCT CASE WHEN o.status IN ('10','22','24','30') THEN ${BILL} END) total_confirmed,COUNT(DISTINCT CASE WHEN o.status IN ('22','24','30') THEN ${BILL} END) total_packed,COUNT(DISTINCT CASE WHEN o.status IN ('24','30') THEN ${BILL} END) total_shipped,COUNT(DISTINCT ${BILL}) total_orders FROM of_orders o WHERE o.shop=? AND o.order_date=?`,
        c.shop,
        today,
      )) ?? {}
    );
  if (path === "/dashboard/customer-alerts") {
    const bounds = kstCreatedBounds(today, today);
    const [fresh, returning, low] = await Promise.all([
      first(
        c,
        "SELECT COUNT(*) n FROM of_customers WHERE shop=? AND created_at>=? AND created_at<?",
        c.shop,
        bounds.from,
        bounds.to,
      ),
      first(
        c,
        "SELECT COUNT(DISTINCT customer_id) n FROM of_orders o WHERE shop=? AND order_date=? AND status<>'40' AND EXISTS(SELECT 1 FROM of_orders p WHERE p.customer_id=o.customer_id AND p.order_date<o.order_date AND p.status<>'40')",
        c.shop,
        today,
      ),
      query(
        c,
        "SELECT cu.name cust_name,cu.mobile,SUM(l.delta) remain_amt FROM of_customers cu JOIN of_ledger l ON l.shop=cu.shop AND l.mobile=cu.mobile AND l.kind='prepay' WHERE cu.shop=? GROUP BY cu.id HAVING SUM(l.delta) BETWEEN 0 AND 10000 ORDER BY cu.id DESC LIMIT 30",
        c.shop,
      ),
    ]);
    return {
      new_customers: Number(fresh?.n ?? 0),
      reorder_customers: Number(returning?.n ?? 0),
      low_balance_list: low,
    };
  }
  if (path === "/dashboard/action-log")
    return query(
      c,
      "SELECT id,kind action,created_at time,actor FROM of_changes WHERE shop=? ORDER BY id DESC LIMIT 30",
      c.shop,
    );
  if (path === "/dashboard/recent-orders")
    return query(
      c,
      `SELECT p.id orderno,COALESCE(json_extract(p.data,'$.cust_name'),cu.name) cust_name,SUM(${NET}) tamt,p.status,p.created_at FROM of_orders p JOIN of_customers cu ON cu.id=p.customer_id JOIN of_orders o ON o.shop=p.shop AND (o.id=p.id OR o.merged_into=p.id) WHERE p.shop=? AND p.merged_into IS NULL GROUP BY p.id ORDER BY p.id DESC LIMIT 10`,
      c.shop,
    );
  if (path === "/dashboard/sales-series") {
    const range = salesSeriesRange(data, today),
      rows = await dailyRows(c, range.from, range.to);
    return salesSeries(rows, range.mode, range.from, range.to);
  }
  if (path === "/dashboard/sales-compare") {
    const kind = text(data.kind) || "dow",
      base = reportDay(data.base ?? today),
      scaffold = salesComparison([], kind, base);
    const from =
      kind === "year"
        ? `${Number(base.slice(0, 4)) - 5}0101`
        : kind === "month"
          ? `${Number(base.slice(0, 4)) - 1}0101`
          : scaffold.card.prevFrom;
    return salesComparison(await dailyRows(c, from, base), kind, base);
  }
  const range = reportRange(data);
  if (path === "/dashboard/top-items")
    return query(
      c,
      "SELECT i.name iname,i.unit,SUM(i.quantity) qty,SUM(i.price*i.quantity) amt FROM of_order_items i JOIN of_orders o ON o.id=i.order_id WHERE o.shop=? AND o.status<>'40' AND o.order_date BETWEEN ? AND ? GROUP BY i.name,i.unit ORDER BY amt DESC,i.name LIMIT 5",
      c.shop,
      range.from,
      range.to,
    );
  if (path === "/dashboard/sales-range") {
    const current = await aggregate(c, range.from, range.to);
    return {
      ...current,
      from: range.from,
      to: range.to,
      summary: current,
      current,
      cur: current,
      topItems: await dashboardApi(c, "/dashboard/top-items", data),
      payMethods: await query(
        c,
        `SELECT COALESCE(json_extract(o.data,'$.pay_gbn'),'transfer') name,COUNT(DISTINCT ${BILL}) cnt,SUM(${NET}) amt FROM of_orders o WHERE o.shop=? AND o.status<>'40' AND o.order_date BETWEEN ? AND ? GROUP BY name`,
        c.shop,
        range.from,
        range.to,
      ),
      customers: {
        new: current.newCustomers,
        returning: current.returningCustomers,
      },
    };
  }
  return undefined;
}
