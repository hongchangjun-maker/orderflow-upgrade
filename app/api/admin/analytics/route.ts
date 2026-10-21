import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
    const days = requested === 7 || requested === 90 ? requested : 30;
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString();
    const [series, summary] = await Promise.all([
      db.prepare(`
        SELECT date(datetime(created_at, '+9 hours')) AS date,
          COUNT(*) AS orders,
          COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS sales,
          COALESCE(SUM(CASE WHEN status != 'cancelled' AND payment_status = 'paid' THEN total ELSE 0 END), 0) AS paidSales
        FROM orders WHERE created_at >= ?
        GROUP BY date(datetime(created_at, '+9 hours')) ORDER BY date ASC
      `).bind(since).all(),
      db.prepare(`
        SELECT COUNT(*) AS orders,
          COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS sales,
          COALESCE(SUM(CASE WHEN status != 'cancelled' AND payment_status = 'paid' THEN total ELSE 0 END), 0) AS paidSales,
          COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total END), 0) AS averageOrder,
          COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
        FROM orders WHERE created_at >= ?
      `).bind(since).first(),
    ]);
    return Response.json({ days, series: series.results, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
