import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const todayStart = new Date(`${today}T00:00:00+09:00`).toISOString();
    const recentStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [metricsResult, statuses, topProducts, activities, lowStockResult] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS ordersToday, COALESCE(SUM(total), 0) AS salesToday, COALESCE(SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END), 0) AS openOrders FROM orders WHERE created_at >= ?`).bind(todayStart),
      db.prepare(`SELECT status, COUNT(*) AS count FROM orders WHERE created_at >= ? GROUP BY status`).bind(todayStart),
      db.prepare(`SELECT oi.product_name AS name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS sales FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.created_at >= ? AND o.status != 'cancelled' GROUP BY oi.product_id, oi.product_name ORDER BY quantity DESC LIMIT 5`).bind(recentStart),
      db.prepare(`SELECT action, summary, actor, created_at AS createdAt FROM activity_logs ORDER BY id DESC LIMIT 8`),
      db.prepare(`SELECT COUNT(*) AS count FROM products WHERE active = 1 AND stock <= low_stock_at`),
    ]);
    const metrics = metricsResult.results[0] ?? {};
    const lowStock = lowStockResult.results[0] as { count?: number } | undefined;
    return Response.json({ metrics: { ...metrics, lowStock: Number(lowStock?.count ?? 0) }, statuses: statuses.results, topProducts: topProducts.results, activities: activities.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
