import { ensureDatabase, fingerprintRequest, jsonError } from "../../../lib/data";

type OrderPayload = {
  formSlug?: string;
  customerName?: string;
  phone?: string;
  deliveryMethod?: string;
  postalCode?: string;
  address?: string;
  addressDetail?: string;
  requestNote?: string;
  paymentMethod?: string;
  agreed?: boolean;
  website?: string;
  items?: Array<{ productId?: string; quantity?: number }>;
};

const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OrderPayload;
    if (payload.website) return Response.json({ ok: true }, { status: 201 });

    const customerName = cleanText(payload.customerName, 50);
    const phone = cleanText(payload.phone, 20).replace(/[^0-9]/g, "");
    const deliveryMethod = cleanText(payload.deliveryMethod, 20);
    const paymentMethod = cleanText(payload.paymentMethod, 20);
    const formSlug = cleanText(payload.formSlug, 80);
    if (!customerName || !/^01[0-9]{8,9}$/.test(phone) || !payload.agreed) {
      return Response.json({ error: "이름, 휴대폰 번호, 개인정보 동의를 확인해 주세요." }, { status: 400 });
    }
    if (!['delivery', 'pickup'].includes(deliveryMethod) || !['bank', 'pickup'].includes(paymentMethod)) {
      return Response.json({ error: "배송 또는 결제 방법을 확인해 주세요." }, { status: 400 });
    }
    const normalizedItems = (payload.items ?? [])
      .map((item) => ({ productId: cleanText(item.productId, 80), quantity: Math.floor(Number(item.quantity ?? 0)) }))
      .filter((item) => item.productId && item.quantity > 0 && item.quantity <= 50);
    if (normalizedItems.length === 0 || normalizedItems.length > 30) {
      return Response.json({ error: "주문할 상품과 수량을 확인해 주세요." }, { status: 400 });
    }

    const db = await ensureDatabase();
    const fingerprint = await fingerprintRequest(request);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM submission_events WHERE fingerprint = ? AND created_at >= ?`).bind(fingerprint, oneHourAgo).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 8) {
      return Response.json({ error: "잠시 후 다시 주문해 주세요." }, { status: 429 });
    }

    const form = await db.prepare(`SELECT id, min_order_amount AS minOrderAmount, shipping_fee AS shippingFee, free_shipping_at AS freeShippingAt FROM order_forms WHERE slug = ? AND active = 1`).bind(formSlug).first<{ id: string; minOrderAmount: number; shippingFee: number; freeShippingAt: number }>();
    if (!form) return Response.json({ error: "현재 주문할 수 없는 주문서입니다." }, { status: 404 });

    const placeholders = normalizedItems.map(() => "?").join(",");
    const productRows = await db.prepare(`SELECT p.id, p.name, p.price, p.stock FROM products p JOIN form_products fp ON fp.product_id = p.id WHERE fp.form_id = ? AND p.active = 1 AND p.id IN (${placeholders})`).bind(form.id, ...normalizedItems.map((item) => item.productId)).all<{ id: string; name: string; price: number; stock: number }>();
    const products = new Map(productRows.results.map((product) => [product.id, product]));
    if (products.size !== new Set(normalizedItems.map((item) => item.productId)).size) {
      return Response.json({ error: "판매가 종료된 상품이 포함되어 있습니다." }, { status: 409 });
    }

    let subtotal = 0;
    for (const item of normalizedItems) {
      const product = products.get(item.productId)!;
      if (product.stock < item.quantity) return Response.json({ error: `${product.name}의 남은 수량을 확인해 주세요.` }, { status: 409 });
      subtotal += product.price * item.quantity;
    }
    if (subtotal < Number(form.minOrderAmount)) {
      return Response.json({ error: `최소 주문금액은 ${Number(form.minOrderAmount).toLocaleString('ko-KR')}원입니다.` }, { status: 400 });
    }

    const shippingFee = deliveryMethod === "pickup" || (Number(form.freeShippingAt) > 0 && subtotal >= Number(form.freeShippingAt)) ? 0 : Number(form.shippingFee);
    const total = subtotal + shippingFee;
    const now = new Date().toISOString();
    const dateCode = now.slice(2, 10).replaceAll("-", "");
    const orderId = crypto.randomUUID();
    const orderNo = `OF-${dateCode}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    const existingCustomer = await db.prepare(`SELECT id FROM customers WHERE phone = ?`).bind(phone).first<{ id: string }>();
    const customerId = existingCustomer?.id ?? crypto.randomUUID();
    const address = cleanText(payload.address, 160);
    const addressDetail = cleanText(payload.addressDetail, 120);
    if (deliveryMethod === "delivery" && !address) return Response.json({ error: "배송 주소를 입력해 주세요." }, { status: 400 });

    const statements = [
      db.prepare(`INSERT INTO customers (id, name, phone, address, order_count, total_spent, points, last_ordered_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address, order_count = customers.order_count + 1, total_spent = customers.total_spent + excluded.total_spent, last_ordered_at = excluded.last_ordered_at, updated_at = excluded.updated_at`).bind(customerId, customerName, phone, `${address} ${addressDetail}`.trim(), total, now, now, now),
      db.prepare(`INSERT INTO orders (id, order_no, form_id, customer_id, customer_name, customer_phone, delivery_method, postal_code, address, address_detail, request_note, payment_method, payment_status, status, subtotal, shipping_fee, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'new', ?, ?, ?, ?, ?)`).bind(orderId, orderNo, form.id, customerId, customerName, phone, deliveryMethod, cleanText(payload.postalCode, 12), address, addressDetail, cleanText(payload.requestNote, 300), paymentMethod, subtotal, shippingFee, total, now, now),
      ...normalizedItems.flatMap((item) => {
        const product = products.get(item.productId)!;
        return [
          db.prepare(`INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), orderId, product.id, product.name, product.price, item.quantity, product.price * item.quantity),
          db.prepare(`UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?`).bind(item.quantity, now, product.id),
        ];
      }),
      db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('order.created', ?, 'customer', ?)`).bind(`${orderNo} 새 주문`, now),
      db.prepare(`INSERT INTO submission_events (fingerprint, created_at) VALUES (?, ?)`).bind(fingerprint, now),
      db.prepare(`DELETE FROM submission_events WHERE created_at < ?`).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ];
    await db.batch(statements);
    return Response.json({ order: { id: orderId, orderNo, total, status: "new" } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
