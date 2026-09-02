import test from "node:test";
import assert from "node:assert/strict";
import { canonicalOrderRequest, normalizeOrderPayload, OrderInputError, priceOrder } from "../app/modules/orders/domain.ts";

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
