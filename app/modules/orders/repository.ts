import type { FormCatalog, NormalizedOrder, PricedOrder } from "./domain";
import { chunkItems } from "./domain";

export type StoredOrder = { id: string; orderNo: string; total: number; status: string; requestHash?: string | null };

export async function loadSubmissionGate(db: D1Database, idempotencyKey: string, fingerprint: string, since: string) {
  return db.prepare(`
    SELECT
      (SELECT id FROM orders WHERE idempotency_key = ?) AS id,
      (SELECT order_no FROM orders WHERE idempotency_key = ?) AS orderNo,
      (SELECT total FROM orders WHERE idempotency_key = ?) AS total,
      (SELECT status FROM orders WHERE idempotency_key = ?) AS status,
      (SELECT request_hash FROM orders WHERE idempotency_key = ?) AS requestHash,
      (SELECT COUNT(*) FROM submission_events WHERE fingerprint = ? AND created_at >= ?) AS recentCount
  `).bind(idempotencyKey, idempotencyKey, idempotencyKey, idempotencyKey, idempotencyKey, fingerprint, since)
    .first<StoredOrder & { recentCount: number }>();
}

export async function findOrderByIdempotency(db: D1Database, idempotencyKey: string) {
  return db.prepare(`SELECT id, order_no AS orderNo, total, status, request_hash AS requestHash FROM orders WHERE idempotency_key = ?`)
    .bind(idempotencyKey).first<StoredOrder>();
}

export async function loadOrderCatalog(db: D1Database, formSlug: string, productIds: string[]): Promise<FormCatalog | null> {
  const placeholders = productIds.map(() => "?").join(",");
  const rows = await db.prepare(`
    WITH target_form AS (
      SELECT id, min_order_amount, shipping_fee, free_shipping_at
      FROM order_forms WHERE slug = ? AND active = 1
    )
    SELECT f.id AS formId, f.min_order_amount AS minOrderAmount, f.shipping_fee AS shippingFee,
      f.free_shipping_at AS freeShippingAt, p.id, p.name, p.price, p.stock
    FROM target_form f
    LEFT JOIN form_products fp ON fp.form_id = f.id
    LEFT JOIN products p ON p.id = fp.product_id AND p.active = 1 AND p.id IN (${placeholders})
  `).bind(formSlug, ...productIds).all<{
    formId: string; minOrderAmount: number; shippingFee: number; freeShippingAt: number;
    id: string | null; name: string | null; price: number | null; stock: number | null;
  }>();
  if (rows.results.length === 0) return null;
  const first = rows.results[0];
  const products = new Map();
  for (const row of rows.results) {
    if (row.id && row.name !== null && row.price !== null && row.stock !== null) {
      products.set(row.id, { id: row.id, name: row.name, price: Number(row.price), stock: Number(row.stock) });
    }
  }
  return {
    id: first.formId,
    minOrderAmount: Number(first.minOrderAmount),
    shippingFee: Number(first.shippingFee),
    freeShippingAt: Number(first.freeShippingAt),
    products,
  };
}

type CommitInput = {
  order: NormalizedOrder;
  priced: PricedOrder;
  formId: string;
  customerId: string;
  orderId: string;
  orderNo: string;
  requestHash: string;
  fingerprint: string;
  now: string;
};

export function buildCommitStatements(db: D1Database, input: CommitInput): D1PreparedStatement[] {
  const { order, priced, formId, customerId, orderId, orderNo, requestHash, fingerprint, now } = input;
  const addressLine = `${order.address} ${order.addressDetail}`.trim();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO customers (id, name, phone, address, order_count, total_spent, points, last_ordered_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address,
      order_count = customers.order_count + 1, total_spent = customers.total_spent + excluded.total_spent,
      last_ordered_at = excluded.last_ordered_at, updated_at = excluded.updated_at`)
      .bind(customerId, order.customerName, order.phone, addressLine, priced.total, now, now, now),
    db.prepare(`INSERT INTO orders (id, order_no, form_id, customer_id, customer_name, customer_phone, delivery_method,
      postal_code, address, address_detail, request_note, payment_method, payment_status, status, subtotal, shipping_fee,
      total, idempotency_key, request_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'new', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, orderNo, formId, customerId, order.customerName, order.phone, order.deliveryMethod, order.postalCode,
        order.address, order.addressDetail, order.requestNote, order.paymentMethod, priced.subtotal, priced.shippingFee,
        priced.total, order.idempotencyKey, requestHash, now, now),
  ];

  for (const group of chunkItems(priced.items, 14)) {
    const values = group.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
    statements.push(db.prepare(`INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total) VALUES ${values}`)
      .bind(...group.flatMap((item) => [crypto.randomUUID(), orderId, item.product.id, item.product.name, item.product.price, item.quantity, item.lineTotal])));
  }

  const stockCases = priced.items.map(() => "WHEN ? THEN ?").join(" ");
  const stockIds = priced.items.map(() => "?").join(",");
  statements.push(db.prepare(`UPDATE products SET stock = stock - CASE id ${stockCases} ELSE 0 END, updated_at = ? WHERE id IN (${stockIds})`)
    .bind(...priced.items.flatMap((item) => [item.product.id, item.quantity]), now, ...priced.items.map((item) => item.product.id)));
  statements.push(
    db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('order.created', ?, 'customer', ?)`)
      .bind(`${orderNo} 새 주문`, now),
    db.prepare(`INSERT INTO submission_events (fingerprint, created_at) VALUES (?, ?)`).bind(fingerprint, now),
  );
  return statements;
}

export function commitOrder(db: D1Database, input: CommitInput) {
  return db.batch(buildCommitStatements(db, input));
}

export function isRetryableD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Network connection lost|storage caused object to be reset|reset because its code was updated|overloaded|SQLITE_BUSY|database is locked/i.test(message);
}

export function isStockConflict(error: unknown): boolean {
  return /insufficient_stock/i.test(error instanceof Error ? error.message : String(error));
}
