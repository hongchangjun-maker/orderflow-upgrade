import { requireAdminApi } from "../../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../../lib/data";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9-]{8,80}$/u.test(id)) return Response.json({ error: "주문 번호를 확인해 주세요." }, { status: 400 });
    const db = await ensureDatabase();
    const [order, items] = await Promise.all([
      db.prepare(`
        SELECT o.id, o.order_no AS orderNo, o.customer_name AS customerName, o.customer_phone AS customerPhone,
          o.delivery_method AS deliveryMethod, o.postal_code AS postalCode, o.address, o.address_detail AS addressDetail,
          o.request_note AS requestNote, o.payment_method AS paymentMethod, o.payment_status AS paymentStatus,
          o.status, o.subtotal, o.shipping_fee AS shippingFee, o.total, o.created_at AS createdAt, o.updated_at AS updatedAt
        FROM orders o WHERE o.id = ? LIMIT 1
      `).bind(id).first(),
      db.prepare(`SELECT product_name AS productName, unit_price AS unitPrice, quantity, line_total AS lineTotal FROM order_items WHERE order_id = ? ORDER BY id`).bind(id).all(),
    ]);
    if (!order) return Response.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ order: { ...order, items: items.results } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
