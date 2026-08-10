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
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status !== "all" && statuses.has(status)) { clauses.push("o.status = ?"); params.push(status); }
    if (query) { clauses.push("(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)"); const like = `%${query}%`; params.push(like, like, like); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await db.prepare(`SELECT o.id, o.order_no AS orderNo, o.customer_name AS customerName, o.customer_phone AS customerPhone, o.delivery_method AS deliveryMethod, o.payment_method AS paymentMethod, o.payment_status AS paymentStatus, o.status, o.total, o.request_note AS requestNote, o.created_at AS createdAt, COALESCE((SELECT GROUP_CONCAT(oi.product_name || ' × ' || oi.quantity, ', ') FROM order_items oi WHERE oi.order_id = o.id), '') AS items FROM orders o ${where} ORDER BY o.created_at DESC LIMIT 120`).bind(...params).all();
    return Response.json({ orders: rows.results }, { headers: { "Cache-Control": "no-store" } });
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
