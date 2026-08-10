import { ensureDatabase, jsonError } from "../../../../lib/data";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const db = await ensureDatabase();
    const form = await db
      .prepare(`SELECT id, slug, title, notice, min_order_amount AS minOrderAmount, shipping_fee AS shippingFee, free_shipping_at AS freeShippingAt FROM order_forms WHERE slug = ? AND active = 1`)
      .bind(slug)
      .first<Record<string, unknown>>();
    if (!form) return Response.json({ error: "열려 있는 주문서를 찾을 수 없습니다." }, { status: 404 });

    const shop = await db.prepare(`SELECT name, tagline, phone, payment_guide AS paymentGuide FROM shops WHERE id = 'main'`).first();
    const products = await db
      .prepare(`SELECT p.id, p.name, p.category, p.unit, p.price, p.stock, p.low_stock_at AS lowStockAt, p.icon, p.description, p.active, p.sort_order AS sortOrder FROM products p JOIN form_products fp ON fp.product_id = p.id WHERE fp.form_id = ? AND p.active = 1 ORDER BY fp.sort_order, p.sort_order`)
      .bind(form.id)
      .all();

    return Response.json(
      { form: { ...form, shop, products: products.results } },
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
