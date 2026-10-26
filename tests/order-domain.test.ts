import test from "node:test";
import assert from "node:assert/strict";
import { canonicalOrderRequest, normalizeOrderPayload, OrderInputError, priceOrder } from "../app/modules/orders/domain.ts";
import { classifyCustomer } from "../app/modules/customers/segments.ts";
import { applyAdvertisingRules, messageBytes, renderMessageTemplate } from "../app/modules/messages/templates.ts";
import { canTransitionDeliveryRun, validateDeliveryRunDraft } from "../app/modules/operations/domain.ts";
import { createDemoOrders, filterDemoOrders, summarizeDemoOrders } from "../app/lib/demo-orders.ts";

const basePayload = {
  formSlug: "fresh-market",
  customerName: "테스트 고객",
  phone: "010-1234-5678",
  deliveryMethod: "delivery",
  postalCode: "12345",
  address: "서울시 테스트로 1",
  addressDetail: "101호",
  requestNote: "문 앞",
  paymentMethod: "bank",
  agreed: true,
  idempotencyKey: "test-idempotency-key-001",
  items: [{ productId: "prod-apple", quantity: 2 }],
};

test("동일 상품 행을 하나로 합쳐 중복 차감을 막는다", () => {
  const normalized = normalizeOrderPayload({
    ...basePayload,
    items: [{ productId: "prod-apple", quantity: 2 }, { productId: "prod-apple", quantity: 3 }],
  });
  assert.deepEqual(normalized.items, [{ productId: "prod-apple", quantity: 5 }]);
});

test("로그인 없는 시뮬레이션은 최대 2천 건의 고유 가상 주문을 만든다", () => {
  const orders = createDemoOrders(2_500, 0, Date.parse("2026-10-26T03:00:00.000Z"));
  assert.equal(orders.length, 2_000);
  assert.equal(new Set(orders.map((order) => order.id)).size, 2_000);
  assert.ok(orders.every((order) => order.orderNo.startsWith("SIM-")));
});

test("가상 주문 검색과 상태·기간 필터가 실제 목록 규칙처럼 함께 적용된다", () => {
  const orders = createDemoOrders(80, 0, Date.parse("2026-10-26T03:00:00.000Z"));
  const target = orders.find((order) => order.status === "new");
  assert.ok(target);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(target.createdAt));
  const filtered = filterDemoOrders(orders, "new", target.customerPhone, date, date);
  assert.ok(filtered.some((order) => order.id === target.id));
  assert.ok(filtered.every((order) => order.status === "new"));
});

test("가상 주문 요약은 취소 주문을 매출에서 제외한다", () => {
  const orders = createDemoOrders(50, 0, Date.parse("2026-10-26T03:00:00.000Z"));
  const summary = summarizeDemoOrders(orders);
  assert.equal(summary.total, 50);
  assert.equal(summary.sales, orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + order.total, 0));
});

test("배송과 결제 방법이 맞지 않으면 거절한다", () => {
  assert.throws(
    () => normalizeOrderPayload({ ...basePayload, paymentMethod: "pickup" }),
    (error) => error instanceof OrderInputError && error.status === 400,
  );
});

test("재고와 최소 주문금액을 반영해 총액을 계산한다", () => {
  const order = normalizeOrderPayload(basePayload);
  const priced = priceOrder(order, {
    id: "form-main",
    minOrderAmount: 10_000,
    shippingFee: 3_000,
    freeShippingAt: 50_000,
    products: new Map([["prod-apple", { id: "prod-apple", name: "사과", price: 8_000, stock: 100 }]]),
  });
  assert.equal(priced.subtotal, 16_000);
  assert.equal(priced.shippingFee, 3_000);
  assert.equal(priced.total, 19_000);
});

test("재고보다 많은 주문은 409 충돌로 분류한다", () => {
  const order = normalizeOrderPayload(basePayload);
  assert.throws(
    () => priceOrder(order, {
      id: "form-main", minOrderAmount: 0, shippingFee: 0, freeShippingAt: 0,
      products: new Map([["prod-apple", { id: "prod-apple", name: "사과", price: 8_000, stock: 1 }]]),
    }),
    (error) => error instanceof OrderInputError && error.status === 409 && error.code === "insufficient_stock",
  );
});

test("상품 순서와 무관하게 같은 요청 해시 원문을 만든다", () => {
  const first = normalizeOrderPayload({ ...basePayload, items: [{ productId: "prod-b", quantity: 1 }, { productId: "prod-a", quantity: 2 }] });
  const second = normalizeOrderPayload({ ...basePayload, items: [{ productId: "prod-a", quantity: 2 }, { productId: "prod-b", quantity: 1 }] });
  assert.equal(canonicalOrderRequest(first), canonicalOrderRequest(second));
});

test("고객 분류는 VIP를 우선하고 최근 주문 단골을 구분한다", () => {
  const now = new Date("2026-10-21T00:00:00.000Z");
  assert.equal(classifyCustomer({ orderCount: 10, totalSpent: 1000, lastOrderedAt: null }, now), "vip");
  assert.equal(classifyCustomer({ orderCount: 4, totalSpent: 1000, lastOrderedAt: "2026-10-01T00:00:00.000Z" }, now), "regular");
  assert.equal(classifyCustomer({ orderCount: 1, totalSpent: 1000, lastOrderedAt: "2026-05-01T00:00:00.000Z" }, now), "inactive");
});

test("배송 작업은 주문 중복을 제거하고 종료 상태를 되돌리지 않는다", () => {
  const draft = validateDeliveryRunDraft({ serviceDate: "2026-10-22", title: "오전 배송", orderIds: ["order-12345678", "order-12345678"] });
  assert.deepEqual(draft.orderIds, ["order-12345678"]);
  assert.equal(canTransitionDeliveryRun("planned", "running"), true);
  assert.equal(canTransitionDeliveryRun("completed", "running"), false);
});

test("광고 메시지는 필수 표기와 템플릿 변수를 안전하게 보완한다", () => {
  const advertising = applyAdvertisingRules("사과가 입고되었습니다.");
  assert.match(advertising, /^\(광고\)/u);
  assert.match(advertising, /수신거부/u);
  assert.equal(renderMessageTemplate("{고객명}님 {주문번호}", { "{고객명}": "김고객", "{주문번호}": "O-1" }), "김고객님 O-1");
  assert.equal(messageBytes("가"), 3);
});
