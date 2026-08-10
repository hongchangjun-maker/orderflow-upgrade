import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const form = await db.prepare(`SELECT id, slug, title, notice, min_order_amount AS minOrderAmount, shipping_fee AS shippingFee, free_shipping_at AS freeShippingAt, active, created_at AS createdAt, updated_at AS updatedAt FROM order_forms ORDER BY created_at DESC LIMIT 1`).first();
    const selected = form ? await db.prepare(`SELECT product_id AS productId FROM form_products WHERE form_id = ?`).bind((form as { id: string }).id).all() : { results: [] };
    return Response.json({ form: form ? { ...form, productIds: selected.results.map((row) => (row as { productId: string }).productId) } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const payload = await request.json() as { id?: string; title?: string; notice?: string; minOrderAmount?: number; shippingFee?: number; freeShippingAt?: number; active?: boolean; productIds?: string[] };
    const title = payload.title?.trim().slice(0, 120) ?? "";
    if (!payload.id || !title) return Response.json({ error: "주문서 제목을 입력해 주세요." }, { status: 400 });
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    const productIds = [...new Set((payload.productIds ?? []).filter((id) => typeof id === "string" && id.length < 100))];
    const statements = [
      db.prepare(`UPDATE order_forms SET title = ?, notice = ?, min_order_amount = ?, shipping_fee = ?, free_shipping_at = ?, active = ?, updated_at = ? WHERE id = ?`).bind(title, payload.notice?.trim().slice(0, 500) ?? "", Math.max(0, Math.floor(Number(payload.minOrderAmount) || 0)), Math.max(0, Math.floor(Number(payload.shippingFee) || 0)), Math.max(0, Math.floor(Number(payload.freeShippingAt) || 0)), payload.active === false ? 0 : 1, now, payload.id),
      db.prepare(`DELETE FROM form_products WHERE form_id = ?`).bind(payload.id),
      ...productIds.map((productId, index) => db.prepare(`INSERT INTO form_products (form_id, product_id, sort_order) VALUES (?, ?, ?)`).bind(payload.id, productId, index * 10)),
      db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('form.updated', ?, ?, ?)`).bind(`${title} 주문서 저장`, admin.email, now),
    ];
    await db.batch(statements);
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
