import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const integer = (value: unknown, min = 0, max = 100000000) => Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const rows = await db.prepare(`SELECT id, name, category, unit, price, stock, low_stock_at AS lowStockAt, icon, description, active, sort_order AS sortOrder FROM products ORDER BY sort_order, created_at DESC`).all();
    return Response.json({ products: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const name = text(payload.name, 100);
    const category = text(payload.category, 40);
    const unit = text(payload.unit, 40);
    if (!name || !category || !unit) return Response.json({ error: "상품명, 분류, 판매단위를 입력해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    await db.batch([
      db.prepare(`INSERT INTO products (id, name, category, unit, price, stock, low_stock_at, icon, description, active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(id, name, category, unit, integer(payload.price), integer(payload.stock), integer(payload.lowStockAt, 0, 10000), text(payload.icon, 20) || "BOX", text(payload.description, 240), integer(payload.sortOrder, 0, 10000), now, now),
      db.prepare(`INSERT OR IGNORE INTO form_products (form_id, product_id, sort_order) VALUES ('form-fresh', ?, ?)`).bind(id, integer(payload.sortOrder, 0, 10000)),
      db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('product.created', ?, ?, ?)`).bind(`${name} 상품 등록`, admin.email, now),
    ]);
    return Response.json({ product: { id } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = text(payload.id, 80);
    const name = text(payload.name, 100);
    const category = text(payload.category, 40);
    const unit = text(payload.unit, 40);
    if (!id || !name || !category || !unit) return Response.json({ error: "상품 정보를 확인해 주세요." }, { status: 400 });
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    const result = await db.prepare(`UPDATE products SET name = ?, category = ?, unit = ?, price = ?, stock = ?, low_stock_at = ?, icon = ?, description = ?, active = ?, sort_order = ?, updated_at = ? WHERE id = ?`).bind(name, category, unit, integer(payload.price), integer(payload.stock), integer(payload.lowStockAt, 0, 10000), text(payload.icon, 20) || "BOX", text(payload.description, 240), payload.active === false ? 0 : 1, integer(payload.sortOrder, 0, 10000), now, id).run();
    if (!result.meta.changes) return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });
    await db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('product.updated', ?, ?, ?)`).bind(`${name} 상품 수정`, admin.email, now).run();
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
