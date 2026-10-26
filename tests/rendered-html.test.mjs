import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished ORDERFLOW landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ORDERFLOW/);
  assert.match(html, /주문은 더 쉽게/);
  assert.match(html, /고객 주문서 보기/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships product metadata and removes disposable starter assets", async () => {
  const [layout, page, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /og\.webp/);
  assert.match(layout, /주문은 더 쉽게, 운영은 더 우아하게/);
  assert.match(page, /order\/fresh-market/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.webp", import.meta.url));
  await access(new URL("../public/visuals/orderflow-mark.webp", import.meta.url));
  assert.doesNotMatch(`${layout}\n${page}`, /chatgpt\.site|signin-with-chatgpt|site-creator/i);
});

test("keeps familiar bulk order workflows on the new authenticated API", async () => {
  const [workbench, orderRoute, orderForm] = await Promise.all([
    readFile(new URL("../app/admin/orders-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/orders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/order/[slug]/order-form.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(workbench, /간편 모드/);
  assert.match(workbench, /업무 모드/);
  assert.match(workbench, /상태 일괄 변경/);
  assert.match(workbench, /조회 기간/);
  assert.match(orderRoute, /validateMutationRequest/);
  assert.match(orderRoute, /slice\(0, 100\)/);
  assert.match(orderForm, /사진 크게/);
  assert.match(orderForm, /빠른 주문/);
});

test("opens a login-free simulation while keeping real administration behind the secure route", async () => {
  const [adminPage, securePage, demoApp, home] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/secure/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/demo-admin-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(adminPage, /DemoAdminApp/);
  assert.doesNotMatch(adminPage, /AdminLogin|getAdminUser/);
  assert.match(securePage, /AdminLogin/);
  assert.match(securePage, /getAdminUser/);
  assert.match(demoApp, /1,000건 부하 구성/);
  assert.match(demoApp, /실제 D1 주문과 관리자 계정에는 접근하지 않습니다/);
  assert.match(demoApp, /orderflow-demo-orders\.csv/);
  assert.match(demoApp, /가상 데이터 즉시 반영/);
  assert.doesNotMatch(demoApp, /fetch\(/);
  assert.match(home, /바로 시뮬레이션/);
  assert.doesNotMatch(home, /관리자 로그인/);
});
