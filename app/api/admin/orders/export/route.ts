import { requireAdminApi } from "../../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../../lib/data";

const statuses = new Set(["new", "confirmed", "packing", "shipping", "done", "cancelled"]);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+09:00`));
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
};

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
    if (query) { const like = `%${query}%`; clauses.push("(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)"); params.push(like, like, like); }
    const dateFrom = (url.searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (url.searchParams.get("dateTo") ?? "").trim();
    if (validDate(dateFrom)) { clauses.push("o.created_at >= ?"); params.push(new Date(`${dateFrom}T00:00:00+09:00`).toISOString()); }
    if (validDate(dateTo)) { clauses.push("o.created_at < ?"); params.push(new Date(Date.parse(`${dateTo}T00:00:00+09:00`) + 86_400_000).toISOString()); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await db.prepare(`
      SELECT o.order_no AS orderNo, o.created_at AS createdAt, o.customer_name AS customerName,
        o.customer_phone AS customerPhone, o.delivery_method AS deliveryMethod, o.address, o.address_detail AS addressDetail,
        COALESCE(GROUP_CONCAT(oi.product_name || ' × ' || oi.quantity, ', '), '') AS items,
        o.subtotal, o.shipping_fee AS shippingFee, o.total, o.payment_method AS paymentMethod,
        o.payment_status AS paymentStatus, o.status, o.request_note AS requestNote
      FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id ${where}
      GROUP BY o.id ORDER BY o.created_at DESC LIMIT 5000
    `).bind(...params).all();
    const headers = ["주문번호", "주문일시", "고객명", "휴대폰", "수령방법", "주소", "상세주소", "상품", "상품금액", "배송비", "합계", "결제방법", "입금상태", "주문상태", "요청사항"];
    const keys = ["orderNo", "createdAt", "customerName", "customerPhone", "deliveryMethod", "address", "addressDetail", "items", "subtotal", "shippingFee", "total", "paymentMethod", "paymentStatus", "status", "requestNote"];
    const csv = [headers.map(csvCell).join(","), ...rows.results.map((row) => keys.map((key) => csvCell((row as Record<string, unknown>)[key])).join(","))].join("\r\n");
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
    return new Response(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="orderflow-orders-${stamp}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
