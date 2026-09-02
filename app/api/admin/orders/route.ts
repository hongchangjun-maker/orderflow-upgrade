import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

const statuses = new Set(["new", "confirmed", "packing", "shipping", "done", "cancelled"]);

export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "all";
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const cursor = (url.searchParams.get("cursor") ?? "").trim().slice(0, 100);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status !== "all" && statuses.has(status)) { clauses.push("o.status = ?"); params.push(status); }
    if (query) { clauses.push("(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)"); const like = `%${query}%`; params.push(like, like, like); }
    const [cursorCreatedAt, cursorId] = cursor.split("|");
    if (cursorCreatedAt && cursorId && /^\d{4}-\d{2}-\d{2}T/u.test(cursorCreatedAt) && /^[a-zA-Z0-9-]{8,80}$/u.test(cursorId)) {
      clauses.push("(o.created_at < ? OR (o.created_at = ? AND o.id < ?))");
      params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await db.prepare(`
      WITH page AS (
        SELECT o.id, o.order_no AS orderNo, o.customer_name AS customerName, o.customer_phone AS customerPhone,
          o.delivery_method AS deliveryMethod, o.payment_method AS paymentMethod, o.payment_status AS paymentStatus,
          o.status, o.total, o.request_note AS requestNote, o.created_at AS createdAt
        FROM orders o ${where}
        ORDER BY o.created_at DESC, o.id DESC LIMIT 61
      )
      SELECT page.*, COALESCE(GROUP_CONCAT(oi.product_name || ' × ' || oi.quantity, ', '), '') AS items
      FROM page LEFT JOIN order_items oi ON oi.order_id = page.id
      GROUP BY page.id ORDER BY page.createdAt DESC, page.id DESC
    `).bind(...params).all();
    const hasMore = rows.results.length > 60;
    const orders = rows.results.slice(0, 60);
    const last = orders.at(-1) as { createdAt?: string; id?: string } | undefined;
    const nextCursor = hasMore && last?.createdAt && last.id ? `${last.createdAt}|${last.id}` : null;
    return Response.json({ orders, nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const payload = (await request.json()) as { id?: string; status?: string; paymentStatus?: string };
    if (!payload.id || !payload.status || !statuses.has(payload.status)) return Response.json({ error: "변경할 주문 상태를 확인해 주세요." }, { status: 400 });
    const paymentStatus = payload.paymentStatus === "paid" ? "paid" : payload.paymentStatus === "unpaid" ? "unpaid" : null;
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const result = paymentStatus
      ? await db.prepare(`UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?`).bind(payload.status, paymentStatus, now, payload.id).run()
      : await db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).bind(payload.status, now, payload.id).run();
    if (!result.meta.changes) return Response.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
    await db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('order.status', ?, ?, ?)`).bind(`주문 상태를 ${payload.status}(으)로 변경`, admin.email, now).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
