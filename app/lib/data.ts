import { env } from "cloudflare:workers";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', payment_guide TEXT NOT NULL DEFAULT '', order_complete_message TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), stock INTEGER NOT NULL CHECK(stock >= 0), low_stock_at INTEGER NOT NULL DEFAULT 5, icon TEXT NOT NULL DEFAULT 'BOX', description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_forms (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '', open_at TEXT, close_at TEXT, min_order_amount INTEGER NOT NULL DEFAULT 0, shipping_fee INTEGER NOT NULL DEFAULT 0, free_shipping_at INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS form_products (form_id TEXT NOT NULL, product_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (form_id, product_id))`,
  `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '', order_count INTEGER NOT NULL DEFAULT 0, total_spent INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, last_ordered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, form_id TEXT NOT NULL, customer_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, delivery_method TEXT NOT NULL, postal_code TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', address_detail TEXT NOT NULL DEFAULT '', request_note TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'unpaid', status TEXT NOT NULL DEFAULT 'new', subtotal INTEGER NOT NULL, shipping_fee INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL, unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL, line_total INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, summary TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS submission_events (fingerprint TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_active_sort ON products(active, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_submission_events_lookup ON submission_events(fingerprint, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS prevent_negative_stock BEFORE UPDATE OF stock ON products WHEN NEW.stock < 0 BEGIN SELECT RAISE(ABORT, 'insufficient_stock'); END`,
];

const seedProducts = [
  ["prod-peach", "햇살 복숭아", "과일", "1팩 · 5입", 16900, 28, 6, "PEACH", "당도와 향을 선별한 제철 복숭아", 10],
  ["prod-egg", "목초 유정란", "신선", "30개입", 16400, 16, 5, "EGG", "난각번호 1번, 매일 입고", 20],
  ["prod-chicken", "춘천식 닭갈비", "간편식", "500g", 7900, 42, 8, "PAN", "팬 하나로 완성하는 매콤한 한 끼", 30],
  ["prod-melon", "머스크 멜론", "과일", "1.5kg 내외", 18900, 4, 5, "MELON", "후숙 안내를 함께 보내드려요", 40],
  ["prod-kimchi", "여수 파김치", "반찬", "1kg", 11900, 19, 6, "LEAF", "갓 버무린 진한 양념", 50],
  ["prod-curry", "삼일 숙성 카레", "간편식", "210g × 5", 15800, 31, 7, "BOWL", "전자레인지 3분 간편식", 60],
  ["prod-pancake", "고기 빈대떡", "간편식", "390g × 2", 11900, 12, 5, "PAN", "겉바속촉, 막국수와 잘 어울려요", 70],
  ["prod-noodle", "가평 잣막국수", "간편식", "2인분", 7900, 23, 6, "NOODLE", "육수와 양념장이 포함된 구성", 80],
] as const;

export function getD1() {
  if (!env.DB) throw new Error("D1 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO shops (id, name, tagline, phone, payment_guide, order_complete_message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind("main", "오더플로우 마켓", "좋은 상품을 가장 편한 주문으로", "", "계좌이체 주문은 확인 후 입금 안내를 보내드립니다.", "주문이 접수되었습니다. 확인 후 안내드릴게요.", now),
    db.prepare(`INSERT OR IGNORE INTO order_forms (id, slug, title, notice, min_order_amount, shipping_fee, free_shipping_at, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind("form-fresh", "fresh-market", "이번 주 신선마켓", "수량은 실시간 재고 기준이며, 품절 시 주문할 수 없습니다.", 15000, 3500, 50000, now, now),
    ...seedProducts.map((product) => db.prepare(`INSERT OR IGNORE INTO products (id, name, category, unit, price, stock, low_stock_at, icon, description, active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(...product, now, now)),
    ...seedProducts.map((product, index) => db.prepare(`INSERT OR IGNORE INTO form_products (form_id, product_id, sort_order) VALUES (?, ?, ?)`).bind("form-fresh", product[0], index * 10)),
  ]);
  return db;
}

export async function fingerprintRequest(request: Request) {
  const raw = `${request.headers.get("cf-connecting-ip") ?? "local"}|${request.headers.get("user-agent") ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function jsonError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  const safe = message.includes("insufficient_stock") ? "주문 중 재고가 변경되었습니다. 수량을 다시 확인해 주세요." : fallback;
  return Response.json({ error: safe }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
