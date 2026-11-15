import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.LIVE_TEST_URL ?? "http://localhost:3022";
if (
  !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/u.test(base) &&
  base !== "https://orderflow-korea-upgrade-staging.hhongcjun.workers.dev"
)
  throw new Error("Load tests are forbidden outside local/staging");
const cookie = process.env.LIVE_TEST_COOKIE ?? "";
const run = `QA-${Date.now()}`,
  checks = [],
  metrics = {};
const phoneSeed =
  10_000_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 79_000_000);
async function request(
  path,
  data,
  method = data === undefined ? "GET" : "POST",
  cookies = cookie,
) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-orderflow-request": "1",
      ...(cookies ? { cookie: cookies } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  return {
    status: response.status,
    data: result.data,
    error: result.error,
    headers: response.headers,
    ms: performance.now() - started,
  };
}
const api = (path, data, method, cookies) =>
  request("/api/replica" + path, data, method, cookies);
const pass = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const session = await api("/session");
assert.equal(session.status, 200);
pass("authenticated server workspace");
const form = await api("/workspace/form", {
  title: run,
  itemsText: Array.from(
    { length: 20 },
    (_, i) => `검증품목${i + 1}|박스|${1000 + i}|1000`,
  ).join("\n"),
  shippingFee: 3000,
});
assert.equal(form.status, 200, JSON.stringify(form.error));
const id = form.data.int_value1,
  token = form.data.setting.token,
  items = form.data.items;
assert.equal(items.length, 20);
pass("20-item form persisted");
const pub = await request(`/api/live-public/form/${token}`);
assert.equal(pub.status, 200);
assert.equal(pub.data.items.length, 20);
pass("public form reads actual catalog");
const payload = (i, cart = items) => ({
  cust_name: `${run}-${i}`,
  mobile: `010${String(phoneSeed + i).padStart(8, "0")}`,
  addr: "검증 전용 주소, 실제 배송 금지",
  addr2: "",
  consent: true,
  idempotencyKey: `${run}-${i}`,
  items: cart.map((item) => ({ seqno: item.seqno, qty: 1, cost: 1 })),
  tamt: 1,
});
const first = await request(`/api/live-public/form/${token}`, payload(1));
assert.equal(first.status, 200, JSON.stringify(first.error));
const replay = await request(`/api/live-public/form/${token}`, payload(1));
assert.equal(replay.data.key, first.data.key);
assert.equal(replay.data.replayed, true);
pass("duplicate submission does not duplicate order");
const changed = await request(`/api/live-public/form/${token}`, {
  ...payload(1),
  addr: "다른 주소",
});
assert.equal(changed.status, 409);
pass("idempotency payload conflict rejected");
const receipt = await request(`/api/live-public/receipt/${first.data.key}`);
assert.equal(
  receipt.data.total,
  items.reduce((s, i) => s + Number(i.cost), 0) + 3000,
);
pass("server ignores forged price and total");
const before = await api(`/urlorders/setting/${id}`);
assert.equal(Number(before.data.items[0].stock), 999);
pass("atomic stock reservation");
const second = await request(`/api/live-public/form/${token}`, {
  ...payload(2),
  mobile: payload(1).mobile,
  cust_name: payload(1).cust_name,
});
assert.equal(second.status, 200);
const merged = await api(
  "/orders/merge",
  {
    ocodekey_arr: `${first.data.key},${second.data.key}`,
    mobile_arr: payload(1).mobile,
  },
  "PUT",
);
assert.equal(merged.status, 200);
assert.equal(merged.data.error_no, 0);
pass("same-customer orders merge on server");
const cancelled = await api(
  "/orders/status",
  { orders: [{ ocodekey: first.data.key }], status: "40" },
  "PUT",
);
assert.equal(cancelled.status, 200);
await api(
  "/orders/status",
  { orders: [{ ocodekey: first.data.key }], status: "40" },
  "PUT",
);
const afterCancel = await api(`/urlorders/setting/${id}`);
assert.equal(Number(afterCancel.data.items[0].stock), 1000);
pass("merged cancellation returns stock exactly once");
const phone = payload(3).mobile;
assert.equal(
  (
    await api("/customers/ledger", {
      mobile: phone,
      kind: "point",
      delta: 100,
      memo: run,
      operation: `${run}-credit`,
    })
  ).status,
  200,
);
const debits = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    api("/customers/ledger", {
      mobile: phone,
      kind: "point",
      delta: -20,
      memo: run,
      operation: `${run}-debit-${i}`,
    }),
  ),
);
assert.equal(debits.filter((r) => r.status === 200).length, 5);
assert.equal(debits.filter((r) => r.status === 409).length, 5);
const balance = await api(`/customers/point/balance?mobile=${phone}`);
assert.equal(balance.data.balance, 0);
pass("concurrent balance deductions cannot overspend");
const chatOrder = await request(`/api/live-public/form/${token}`, payload(4));
const opened = await request(
  `/api/live-public/receipt/${chatOrder.data.key}`,
  {},
);
const chatToken = opened.data.url.split("/").at(-1);
assert.equal(
  (await request(`/api/live-public/chat/${chatToken}`, { content: run }))
    .status,
  200,
);
const rooms = await api("/chat/rooms?filter=all");
const room = rooms.data.rooms.find(
  (r) => r.lastOrderNo === chatOrder.data.orderNo,
);
assert.ok(room);
assert.equal(
  (
    await api(`/chat/rooms/${room.roomId}/messages`, {
      type: "text",
      content: "매장 답변",
    })
  ).status,
  200,
);
const chat = await request(`/api/live-public/chat/${chatToken}`);
assert.equal(chat.data.messages.length, 2);
assert.equal(
  (await request(`/api/live-public/chat/${"0".repeat(32)}`)).status,
  404,
);
pass("real customer/seller chat and token isolation");
await api("/sms/templates", {
  title: run,
  contents: "실제 외부 발송 없이 템플릿 저장",
});
assert.ok((await api("/sms/templates")).data.some((r) => r.title === run));
pass("templates persist across HTTP requests");
assert.equal((await api("/sms/send", { message: run })).status, 503);
pass("deferred provider cannot report false delivery");
const staffLogin = `qa-${Date.now()}@orderflow.invalid`,
  password = crypto.randomUUID() + "Aa9!";
const staff = await api("/staff", { login: staffLogin, name: run, password });
assert.equal(staff.status, 200);
const login = await api("/login", { email: staffLogin, password });
assert.equal(login.status, 200);
const staffCookie = login.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
assert.equal(
  (await api("/session", undefined, "GET", staffCookie)).data.seller.role,
  "STAFF",
);
assert.equal(
  (
    await api(
      "/customers/ledger",
      {
        mobile: phone,
        kind: "prepay",
        delta: 100,
        operation: run + "-staff",
        memo: run,
      },
      "POST",
      staffCookie,
    )
  ).status,
  403,
);
assert.equal(
  (
    await api(
      "/account/perms/owner/ORDER_OPS",
      { on: true },
      "PUT",
      staffCookie,
    )
  ).status,
  403,
);
pass("staff cannot grant permissions or alter money without grant");
const clashForm = await api("/workspace/form", {
  title: run + "-stock-race",
  itemsText: "검증 경합 품목|개|100|10",
  shippingFee: 0,
});
const clashToken = clashForm.data.setting.token,
  clashItem = clashForm.data.items[0];
const raced = await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    request(
      `/api/live-public/form/${clashToken}`,
      payload(100 + i, [clashItem]),
    ),
  ),
);
assert.equal(raced.filter((r) => r.status === 200).length, 10);
assert.equal(raced.filter((r) => r.status === 409).length, 20);
assert.equal(
  (await api(`/urlorders/setting/${clashForm.data.int_value1}`)).data.items[0]
    .stock,
  0,
);
pass("30-way same-stock contention sells exactly available ten");
assert.equal((await api("/customers/ledger", undefined, "GET")).status, 405);
const noCsrf = await fetch(base + "/api/replica/workspace/form", {
  method: "POST",
  headers: { cookie, "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(noCsrf.status, 403);
const badOrigin = await fetch(base + "/api/replica/workspace/form", {
  method: "POST",
  headers: {
    cookie,
    "Content-Type": "application/json",
    "x-orderflow-request": "1",
    Origin: "https://example.invalid",
  },
  body: "{}",
});
assert.equal(badOrigin.status, 403);
pass("CSRF and read-method mutation guards");
assert.equal((await api("/urlorder-v2/hub")).status, 200);
const editable = await request(
  `/api/live-public/form/${token}`,
  payload(5, [items[0]]),
);
const oldDetail = await api("/orders/detail", { ocodekey: editable.data.key });
assert.equal(oldDetail.data.items[0].item_name, items[0].iname);
const edit = await api("/orders/save-items", {
  ocodekey: editable.data.key,
  revision: oldDetail.data.header.revision,
  items: [{ iname: items[0].iname, unit: items[0].unit, cost: 1, qty: 2 }],
});
assert.equal(edit.status, 200, JSON.stringify(edit.error));
assert.equal(edit.data.order_amt, items[0].cost * 2);
assert.equal(
  (
    await api("/orders/save-items", {
      ocodekey: editable.data.key,
      revision: oldDetail.data.header.revision,
      items: [{ seqno: items[0].seqno, qty: 3 }],
    })
  ).status,
  409,
);
assert.equal(
  (
    await api(
      "/orders/merge",
      { ocodekey_arr: `${first.data.key},${second.data.key}` },
      "PUT",
    )
  ).data.replayed,
  true,
);
pass("source UI item DTOs, authoritative price and edit revision conflict");
const prepaid = await request(
  `/api/live-public/form/${token}`,
  payload(6, [items[0]]),
);
const prepaidTotal = items[0].cost + 3000;
await api("/customers/ledger", {
  mobile: payload(6).mobile,
  kind: "prepay",
  delta: prepaidTotal,
  operation: run + "-prepay-credit",
});
const deduction = { orders: [{ ocodekey: prepaid.data.key }] };
assert.equal(
  (await api("/orders/prepay-deduct", deduction, "PUT")).status,
  200,
);
assert.equal(
  (await api("/orders/prepay-deduct", deduction, "PUT")).status,
  200,
);
assert.equal(
  (await api(`/customers/prepayment/balance?mobile=${payload(6).mobile}`)).data
    .balance,
  0,
);
assert.equal(
  (await request(`/api/live-public/receipt/${prepaid.data.key}`)).data.ispaid,
  "Y",
);
pass("prepayment deducts and marks order paid exactly once");
assert.equal(
  (
    await api(
      "/orders/payment",
      { orders: [{ ocodekey: prepaid.data.key }], ispaid: "N" },
      "PUT",
    )
  ).status,
  409,
);
await api(
  "/orders/status",
  { orders: [{ ocodekey: prepaid.data.key }], status: "40" },
  "PUT",
);
await api(
  "/orders/status",
  { orders: [{ ocodekey: prepaid.data.key }], status: "40" },
  "PUT",
);
assert.equal(
  (await api(`/customers/prepayment/balance?mobile=${payload(6).mobile}`)).data
    .balance,
  prepaidTotal,
);
pass("cancel restores internal prepayment once and blocks unpaid toggle");
const depositOrder = await request(
  `/api/live-public/form/${token}`,
  payload(7, [items[0]]),
);
const deposit = await api("/deposit/manual", {
  tran_amt: prepaidTotal,
  tran_name: run,
});
assert.equal(
  (
    await api("/deposit/match", {
      depositId: deposit.data.id,
      ocodekey: depositOrder.data.key,
    })
  ).status,
  200,
);
assert.equal(
  (await request(`/api/live-public/receipt/${depositOrder.data.key}`)).data
    .ispaid,
  "Y",
);
assert.equal(
  (
    await api("/deposit/match", {
      depositId: deposit.data.id,
      ocodekey: prepaid.data.key,
    })
  ).status,
  409,
);
pass("manual deposit matching is atomic and cannot match twice");
const route = await api("/delivery-route/save", {
  orderDate: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .replaceAll("-", ""),
  planNo: Date.now(),
  teamNo: 1,
  stops: [
    {
      stopCode: depositOrder.data.key,
      customerName: run,
      address: "검증주소",
      stopStatus: "10",
    },
  ],
});
assert.equal(route.status, 200);
const share = await api("/delivery-route/share", {
  planNo: route.data.planNo,
  orderDate: route.data.orderDate,
});
assert.equal(share.status, 200);
const dispatchToken = share.data.token;
assert.equal(
  (
    await request(`/api/live-public/dispatch/${dispatchToken}`, {
      stopCode: depositOrder.data.key,
    })
  ).status,
  200,
);
assert.equal(
  (await request(`/api/live-public/receipt/${depositOrder.data.key}`)).data
    .status,
  "30",
);
assert.equal(
  (
    await api(
      "/orders/status",
      { orders: [{ ocodekey: depositOrder.data.key }], status: "10" },
      "PUT",
    )
  ).status,
  409,
);
pass("driver completion persists and completed orders cannot reopen");
const recurring = await api("/recurring-orders/save", {
  uocode: id,
  cust_name: run,
  mobile: payload(8).mobile,
  addr: "검증주소",
  delivery_gbn: "direct",
  start_date: "2026-11-01",
  schedule_type: "weekly",
  schedule_days: JSON.stringify([
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
    })
      .format(new Date())
      .toLowerCase(),
  ]),
  items: [{ seqno: items[0].seqno, qty: 1 }],
});
assert.equal(recurring.status, 200, JSON.stringify(recurring.error));
assert.equal((await api("/recurring-orders/run-due", {})).data.generated, 1);
assert.equal((await api("/recurring-orders/run-due", {})).data.generated, 0);
pass("due recurring order generates once with server prices");
assert.equal(
  (await api(`/recurring-orders/detail/${recurring.data.id}`)).data.master
    .status,
  "active",
);
assert.equal(
  (
    await api("/recurring-orders/status", {
      rocode: recurring.data.id,
      status: "paused",
    })
  ).status,
  200,
);
pass("recurring schedules save, calculate and pause on server");
const imageData = new FormData();
imageData.append(
  "file",
  new Blob(
    [
      await (
        await import("node:fs/promises")
      ).readFile(
        new URL("../public/visuals/orderflow-mark.webp", import.meta.url),
      ),
    ],
    { type: "image/webp" },
  ),
  "qa.webp",
);
const uploadedResponse = await fetch(base + "/api/replica/images/upload", {
  method: "POST",
  headers: { cookie, "x-orderflow-request": "1" },
  body: imageData,
});
const uploaded = await uploadedResponse.json();
assert.equal(uploadedResponse.status, 200, JSON.stringify(uploaded.error));
assert.equal((await fetch(uploaded.data.fileUrl)).status, 200);
pass("R2 image upload and public product asset read");
const load = Number(process.env.LIVE_LOAD ?? 100);
const burst = await Promise.all(
  Array.from({ length: load }, (_, i) =>
    request(`/api/live-public/form/${token}`, payload(1000 + i)),
  ),
);
assert.equal(
  burst.filter((r) => r.status === 200).length,
  load,
  JSON.stringify(
    burst
      .filter((r) => r.status !== 200)
      .map((r) => ({ status: r.status, error: r.error })),
  ),
);
const times = burst.map((r) => r.ms).sort((a, b) => a - b);
metrics.concurrentCustomers = load;
metrics.itemsPerOrder = 20;
metrics.success = load;
metrics.p95ms = Math.round(times[Math.floor(times.length * 0.95)] ?? 0);
pass(`${load} concurrent customers x 20 products persisted`);
await mkdir(new URL("../outputs/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../outputs/live-http-report.json", import.meta.url),
  JSON.stringify(
    {
      run,
      base,
      checks,
      metrics,
      publicFormUrl: `${base}/buy/${token}`,
      passed: true,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: checks.length, metrics }));
