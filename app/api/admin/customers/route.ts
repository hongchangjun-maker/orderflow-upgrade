import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
    const db = await ensureDatabase();
    const rows = query
      ? await db.prepare(`SELECT id, name, phone, address, order_count AS orderCount, total_spent AS totalSpent, points, last_ordered_at AS lastOrderedAt FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY last_ordered_at DESC LIMIT 100`).bind(`%${query}%`, `%${query}%`).all()
      : await db.prepare(`SELECT id, name, phone, address, order_count AS orderCount, total_spent AS totalSpent, points, last_ordered_at AS lastOrderedAt FROM customers ORDER BY last_ordered_at DESC LIMIT 100`).all();
    return Response.json({ customers: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
