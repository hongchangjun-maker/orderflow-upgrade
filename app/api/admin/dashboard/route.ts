import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const [metrics, statuses, topProducts, activities] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS ordersToday, COALESCE(SUM(total), 0) AS salesToday, COALESCE(SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END), 0) AS openOrders FROM orders WHERE created_at >= ?`).bind(`${today}T00:00:00.000Z`).first(),
      db.prepare(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status`).all(),
      db.prepare(`SELECT product_name AS name, SUM(quantity) AS quantity, SUM(line_total) AS sales FROM order_items GROUP BY product_id, product_name ORDER BY quantity DESC LIMIT 5`).all(),
      db.prepare(`SELECT action, summary, actor, created_at AS createdAt FROM activity_logs ORDER BY id DESC LIMIT 8`).all(),
    ]);
    const lowStock = await db.prepare(`SELECT COUNT(*) AS count FROM products WHERE active = 1 AND stock <= low_stock_at`).first();
    return Response.json({ metrics: { ...metrics, lowStock: Number((lowStock as { count?: number } | null)?.count ?? 0) }, statuses: statuses.results, topProducts: topProducts.results, activities: activities.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
