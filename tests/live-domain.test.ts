import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameCustomer,
  cartOf,
  day,
  integer,
  itemOf,
  LiveError,
  mobileOf,
  nearestRoute,
  obj,
  publicNotice,
  required,
  rows,
  text,
} from "../app/modules/live/domain.ts";

const rejectsInput = (operation: () => unknown, status = 422) =>
  assert.throws(
    operation,
    (error: unknown) => error instanceof LiveError && error.status === status,
  );

test("live domain rejects invalid money and quantity ranges", () => {
  for (const value of [
    -1,
    0.1,
    Number.NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "not-a-number",
  ])
    rejectsInput(() => integer(value));
  assert.equal(integer("23000"), 23000);
  assert.equal(integer(0), 0);
  rejectsInput(() => itemOf({ iname: "사과", cost: -1, stock: 10 }));
  rejectsInput(() => itemOf({ iname: "사과", cost: 1.5, stock: 10 }));
  for (const qty of [0, -1, 1.1, 10000, Infinity])
    rejectsInput(() => cartOf([{ seqno: 1, qty }]));
});

test("live cart merges duplicate products and enforces the combined per-item cap", () => {
  const input = [
    { seqno: 3, qty: 2 },
    { itemId: 3, quantity: 4 },
    { productId: 9, quantity: 1 },
  ];
  assert.deepEqual(cartOf(input), [
    { id: 3, qty: 6 },
    { id: 9, qty: 1 },
  ]);
  assert.deepEqual(input[0], { seqno: 3, qty: 2 });
  assert.deepEqual(cartOf([{ seqno: 1, qty: 9999 }]), [{ id: 1, qty: 9999 }]);
  rejectsInput(() =>
    cartOf([
      { seqno: 1, qty: 6000 },
      { seqno: 1, qty: 4000 },
    ]),
  );
  rejectsInput(() => cartOf([]));
  rejectsInput(() => cartOf({ seqno: 1, qty: 1 }));
  rejectsInput(() => cartOf([{ seqno: 0, qty: 1 }]));
  rejectsInput(() =>
    cartOf(Array.from({ length: 101 }, (_, i) => ({ seqno: i + 1, qty: 1 }))),
  );
});

test("live catalog input rejects negative stock and normalizes safe item defaults", () => {
  rejectsInput(() => itemOf({ iname: "사과", cost: 1000, stock: -1 }));
  rejectsInput(() => itemOf({ iname: "사과", cost: 1000, stock: 1.1 }));
  rejectsInput(() => itemOf({ iname: "사과", cost: 1000, stock: 1_000_000 }));
  rejectsInput(() => itemOf({ iname: "   ", cost: 1000, stock: 1 }));
  const item = itemOf({
    iname: " 사과 ",
    unit: "",
    cost: "12000",
    stock: 0,
    disp_gbn: "N",
    item_max_qty: 3,
  });
  assert.equal(item.iname, "사과");
  assert.equal(item.unit, "개");
  assert.equal(item.cost, 12000);
  assert.equal(item.stock, 0);
  assert.equal(item.use_yn, "N");
  assert.equal(item.item_max_qty, 3);
});

test("live merge rejects different customers, destinations, cancelled and merged orders", () => {
  const order = {
    customer_id: "customer-a",
    status: "10",
    data: { addr: "서울시 시험로", addr2: "101호", delivery_gbn: "direct" },
  };
  const second = { ...order, data: { ...order.data } };
  assert.doesNotThrow(() => assertSameCustomer([order, second]));
  rejectsInput(() => assertSameCustomer([order]), 422);
  rejectsInput(
    () => assertSameCustomer(Array.from({ length: 101 }, () => ({ ...order }))),
    422,
  );
  rejectsInput(
    () => assertSameCustomer([order, { ...second, customer_id: "customer-b" }]),
    409,
  );
  rejectsInput(
    () =>
      assertSameCustomer([
        order,
        { ...second, data: { ...second.data, addr: "다른 배송지" } },
      ]),
    409,
  );
  rejectsInput(
    () =>
      assertSameCustomer([
        order,
        { ...second, data: { ...second.data, addr2: "102호" } },
      ]),
    409,
  );
  rejectsInput(
    () =>
      assertSameCustomer([
        order,
        { ...second, data: { ...second.data, delivery_gbn: "pickup" } },
      ]),
    409,
  );
  rejectsInput(
    () => assertSameCustomer([order, { ...second, status: "40" }]),
    409,
  );
  rejectsInput(
    () =>
      assertSameCustomer([order, { ...second, merged_into: "another-order" }]),
    409,
  );
});

test("nearest route is deterministic, uses the origin and leaves input unchanged", () => {
  const stops = [
    { id: "far", lat: 37.5, lon: 127.5 },
    { id: "near", lat: 37.1, lon: 127.1 },
    { id: "middle", lat: 37.2, lon: 127.2 },
  ];
  const before = structuredClone(stops);
  const route = nearestRoute(stops, { lat: 37, lon: 127 });
  assert.deepEqual(
    route.map((stop) => stop.id),
    ["near", "middle", "far"],
  );
  assert.deepEqual(
    route.map((stop) => stop.seq),
    [1, 2, 3],
  );
  assert.deepEqual(route, nearestRoute(stops, { lat: 37, lon: 127 }));
  assert.deepEqual(stops, before);
  assert.deepEqual(nearestRoute([], { lat: 37, lon: 127 }), []);
  assert.deepEqual(
    nearestRoute(
      [
        { id: "first", lat: 1, lon: 0 },
        { id: "second", lat: 0, lon: 1 },
      ],
      { lat: 0, lon: 0 },
    ).map((stop) => stop.id),
    ["first", "second"],
  );
});

test("public notice strips HTML tags and boundary helpers normalize bounded input", () => {
  const notice = publicNotice({
    notice:
      '<p>가격 안내</p><img src="x" onerror="alert(1)"><strong>안전</strong>',
  });
  assert.equal(notice, "가격 안내안전");
  assert.doesNotMatch(notice, /<|>|onerror/);
  assert.equal(publicNotice({ contents: "<div>본문</div>" }), "본문");
  assert.equal(text("  hello  ", 3), "hel");
  assert.deepEqual(obj([]), {});
  assert.deepEqual(rows(null), []);
  assert.deepEqual(rows([null, { id: 1 }]), [{}, { id: 1 }]);
  rejectsInput(() => required(" ", "제목"));
  assert.equal(mobileOf("010-1234-5678"), "01012345678");
  rejectsInput(() => mobileOf("1234"));
  assert.equal(day(new Date("2026-11-15T16:00:00Z")), "20261116");
});

test("nextSchedule weekly/monthly contracts when the production module is Node-importable", async (t) => {
  let operations: {
    nextSchedule: (master: Record<string, unknown>, after: string) => string;
  };
  try {
    operations = await import("../app/modules/live/schedule.ts");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (
      /cloudflare|Cannot find module|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/u.test(
        reason,
      )
    ) {
      t.skip(
        `Production operations imports platform/infrastructure modules: ${reason.split("\n")[0]}`,
      );
      return;
    }
    throw error;
  }
  const { nextSchedule } = operations;
  assert.equal(
    nextSchedule(
      {
        schedule_type: "weekly",
        schedule_days: '["mon"]',
        start_date: "2026-11-01",
      },
      "20261116",
    ),
    "20261123",
  );
  assert.equal(
    nextSchedule(
      {
        schedule_type: "monthly",
        schedule_days: "[31]",
        start_date: "2026-01-01",
      },
      "20260131",
    ),
    "20260331",
  );
  rejectsInput(() =>
    nextSchedule(
      {
        schedule_type: "weekly",
        schedule_days: "[]",
        start_date: "2026-11-01",
      },
      "20261116",
    ),
  );
});
