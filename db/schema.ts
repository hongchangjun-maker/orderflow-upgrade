import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const shops = sqliteTable("shops", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  phone: text("phone").notNull().default(""),
  paymentGuide: text("payment_guide").notNull().default(""),
  orderCompleteMessage: text("order_complete_message").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  price: integer("price").notNull(),
  stock: integer("stock").notNull(),
  lowStockAt: integer("low_stock_at").notNull().default(5),
  icon: text("icon").notNull().default("BOX"),
  description: text("description").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_products_active_sort").on(table.active, table.sortOrder)]);

export const orderForms = sqliteTable("order_forms", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  notice: text("notice").notNull().default(""),
  openAt: text("open_at"),
  closeAt: text("close_at"),
  minOrderAmount: integer("min_order_amount").notNull().default(0),
  shippingFee: integer("shipping_fee").notNull().default(0),
  freeShippingAt: integer("free_shipping_at").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const formProducts = sqliteTable(
  "form_products",
  {
    formId: text("form_id").notNull(),
    productId: text("product_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.formId, table.productId] })],
);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  address: text("address").notNull().default(""),
  orderCount: integer("order_count").notNull().default(0),
  totalSpent: integer("total_spent").notNull().default(0),
  points: integer("points").notNull().default(0),
  lastOrderedAt: text("last_ordered_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_customers_last_ordered").on(table.lastOrderedAt)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  formId: text("form_id").notNull(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  deliveryMethod: text("delivery_method").notNull(),
  postalCode: text("postal_code").notNull().default(""),
  address: text("address").notNull().default(""),
  addressDetail: text("address_detail").notNull().default(""),
  requestNote: text("request_note").notNull().default(""),
  paymentMethod: text("payment_method").notNull(),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  status: text("status").notNull().default("new"),
  subtotal: integer("subtotal").notNull(),
  shippingFee: integer("shipping_fee").notNull(),
  total: integer("total").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_orders_status_created").on(table.status, table.createdAt),
  index("idx_orders_customer").on(table.customerId, table.createdAt),
  index("idx_orders_created").on(table.createdAt),
  uniqueIndex("idx_orders_idempotency_key").on(table.idempotencyKey),
]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
}, (table) => [
  index("idx_order_items_order").on(table.orderId),
  index("idx_order_items_product").on(table.productId),
]);

export const activityLogs = sqliteTable("activity_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  actor: text("actor").notNull().default("system"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_activity_logs_created").on(table.createdAt)]);

export const submissionEvents = sqliteTable("submission_events", {
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_submission_events_lookup").on(table.fingerprint, table.createdAt)]);

export const adminLoginAttempts = sqliteTable("admin_login_attempts", {
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_admin_login_attempts_lookup").on(table.fingerprint, table.createdAt)]);
