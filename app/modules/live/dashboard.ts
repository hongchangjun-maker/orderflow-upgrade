import { day, text, type Doc } from "./domain";
import { first, query, type LiveContext } from "./store";
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
async function aggregate(c: LiveContext, fr: string, to: string) {
  const r = await first(
    c,
    "SELECT COUNT(CASE WHEN status<>'40' THEN 1 END) orderCnt,COALESCE(SUM(CASE WHEN status<>'40' THEN amount ELSE 0 END),0) itemSales,COALESCE(SUM(CASE WHEN status<>'40' THEN fee ELSE 0 END),0) fee,COALESCE(SUM(CASE WHEN status<>'40' THEN amount+fee ELSE 0 END),0) total,COUNT(CASE WHEN status='40' THEN 1 END) cancelCnt,COALESCE(SUM(CASE WHEN status='40' THEN amount+fee ELSE 0 END),0) cancelAmt,COUNT(DISTINCT CASE WHEN status<>'40' THEN customer_id END) customers FROM of_orders WHERE shop=? AND order_date BETWEEN ? AND ?",
    c.shop,
    fr,
    to,
  );
  const fresh = await first(
    c,
    "SELECT COUNT(*) n FROM (SELECT customer_id,MIN(order_date) first_date FROM of_orders WHERE shop=? AND status<>'40' GROUP BY customer_id) WHERE first_date BETWEEN ? AND ?",
    c.shop,
    fr,
    to,
  );
  return {
    ...zero,
    ...r,
    newCustomers: Number(fresh?.n ?? 0),
    returningCustomers: Number(r?.customers ?? 0) - Number(fresh?.n ?? 0),
    avgPrice: Number(r?.orderCnt)
      ? Math.round(Number(r?.itemSales) / Number(r?.orderCnt))
      : 0,
  };
}
export async function dashboardApi(
  c: LiveContext,
  path: string,
  data: Doc,
): Promise<unknown> {
  if (!path.startsWith("/dashboard/")) return undefined;
  const today = day();
  if (path === "/dashboard/today-summary") {
    const r = await first(
      c,
      "SELECT COUNT(*) today_order_count,COALESCE(SUM(CASE WHEN status<>'40' THEN amount+fee ELSE 0 END),0) today_sales_amount,SUM(status='00') today_pending_count,SUM(status='24') today_shipping_count FROM of_orders WHERE shop=? AND order_date=?",
      c.shop,
      today,
    );
    return r ?? {};
  }
  if (path === "/dashboard/order-status") {
    const all = await query(
      c,
      "SELECT status,COUNT(*) n FROM of_orders WHERE shop=? AND order_date=? GROUP BY status",
      c.shop,
      today,
    );
    return Object.fromEntries(
      [
        ["status_received", "10"],
        ["status_packing", "22"],
        ["status_shipping", "24"],
        ["status_completed", "30"],
      ].map(([k, s]) => [k, Number(all.find((r) => r.status === s)?.n ?? 0)]),
    );
  }
  if (path === "/dashboard/pending-counts") {
    const r = await first(
      c,
      "SELECT SUM(status='00') unconfirmed,SUM(status IN ('00','10')) unpacked,SUM(status IN ('00','10','22')) unshipped,SUM(status IN ('10','22','24','30')) total_confirmed,SUM(status IN ('22','24','30')) total_packed,SUM(status IN ('24','30')) total_shipped,COUNT(*) total_orders FROM of_orders WHERE shop=? AND order_date=?",
      c.shop,
      today,
    );
    return r ?? {};
  }
  if (path === "/dashboard/customer-alerts") {
    const r = await first(
      c,
      "SELECT COUNT(*) n FROM of_customers WHERE shop=? AND substr(created_at,1,10)=?",
      c.shop,
      new Date().toISOString().slice(0, 10),
    );
    const returning = await first(
      c,
      "SELECT COUNT(DISTINCT customer_id) n FROM of_orders o WHERE shop=? AND order_date=? AND EXISTS(SELECT 1 FROM of_orders p WHERE p.customer_id=o.customer_id AND p.order_date<o.order_date AND p.status<>'40')",
      c.shop,
      today,
    );
    const low = await query(
      c,
      "SELECT cu.name cust_name,cu.mobile,SUM(l.delta) remain_amt FROM of_customers cu JOIN of_ledger l ON l.shop=cu.shop AND l.mobile=cu.mobile AND l.kind='prepay' WHERE cu.shop=? GROUP BY cu.id HAVING SUM(l.delta) BETWEEN 0 AND 10000 LIMIT 30",
      c.shop,
    );
    return {
      new_customers: Number(r?.n ?? 0),
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
      "SELECT o.id orderno,c.name cust_name,o.amount+o.fee tamt,o.status,o.created_at FROM of_orders o JOIN of_customers c ON c.id=o.customer_id WHERE o.shop=? ORDER BY o.id DESC LIMIT 10",
      c.shop,
    );
  if (path === "/dashboard/top-items")
    return query(
      c,
      "SELECT i.name iname,SUM(i.quantity) qty,SUM(i.price*i.quantity) amt FROM of_order_items i JOIN of_orders o ON o.id=i.order_id WHERE o.shop=? AND o.status<>'40' GROUP BY i.name ORDER BY amt DESC LIMIT 5",
      c.shop,
    );
  const fr =
      text(data.frDate ?? data.fr_date ?? data.from).replaceAll("-", "") ||
      "00000000",
    to =
      text(data.toDate ?? data.to_date ?? data.to).replaceAll("-", "") ||
      "99999999";
  const current = await aggregate(c, fr, to);
  if (path === "/dashboard/sales-range")
    return {
      ...current,
      summary: current,
      current,
      cur: current,
      topItems: await dashboardApi(c, "/dashboard/top-items", data),
      payMethods: await query(
        c,
        "SELECT COALESCE(json_extract(data,'$.pay_gbn'),'transfer') name,COUNT(*) cnt,SUM(amount+fee) amt FROM of_orders WHERE shop=? AND status<>'40' AND order_date BETWEEN ? AND ? GROUP BY name",
        c.shop,
        fr,
        to,
      ),
      customers: {
        new: current.newCustomers,
        returning: current.returningCustomers,
      },
    };
  if (path === "/dashboard/sales-series") {
    const series = await query(
      c,
      "SELECT order_date date,COUNT(*) orderCnt,SUM(amount) itemSales,SUM(fee) fee,SUM(amount+fee) total FROM of_orders WHERE shop=? AND status<>'40' AND order_date BETWEEN ? AND ? GROUP BY order_date ORDER BY order_date",
      c.shop,
      fr,
      to,
    );
    return { rows: series, series, summary: current };
  }
  if (path === "/dashboard/sales-compare") {
    const from = new Date(
        `${fr.slice(0, 4)}-${fr.slice(4, 6)}-${fr.slice(6, 8)}T12:00:00Z`,
      ),
      until = new Date(
        `${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T12:00:00Z`,
      );
    const span = Math.max(
      1,
      Math.round((until.getTime() - from.getTime()) / 86400000) + 1,
    );
    const fallback = Number.isFinite(from.getTime()) ? from : new Date();
    const priorFr =
      text(data.compareFrDate ?? data.cmp_fr_date).replaceAll("-", "") ||
      day(new Date(fallback.getTime() - span * 86400000));
    const priorTo =
      text(data.compareToDate ?? data.cmp_to_date).replaceAll("-", "") ||
      day(new Date(fallback.getTime() - 86400000));
    const previous = await aggregate(c, priorFr, priorTo);
    return {
      current,
      previous,
      cur: current,
      cmp: previous,
      rows: [
        { name: "현재", ...current },
        { name: "이전", ...previous },
      ],
    };
  }
  return undefined;
}
