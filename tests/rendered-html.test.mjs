import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { unstable_dev } from "wrangler";
import { fileURLToPath } from "node:url";
import {createHash} from 'node:crypto';
let testWorker;
before(async () => {
  testWorker = await unstable_dev(
    fileURLToPath(new URL("../dist/server/index.js", import.meta.url)),
    {
      config: "dist/server/wrangler.json",
      local: true,
      persist: false,
      logLevel: "error",
      port: 0,
      vars: { ENVIRONMENT: "production", LOCAL_ADMIN_BYPASS: "0" },
      experimental: { disableExperimentalWarning: true, watch: false },
    },
  );
});
after(async () => {
  await testWorker?.stop();
});
test('serves versioned immutable source modules through the actual built asset binding',async()=>{
  const release=await readFile(new URL('../app/modules/live/release.ts',import.meta.url),'utf8');
  const version=release.match(/REPLICA_ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  assert.ok(version);
  const response=await testWorker.fetch('/replica-assets/'+version+'/application.js');
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/u);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(new Uint8Array(await response.arrayBuffer())),hash(await readFile(new URL('../public/replica-assets/application.js',import.meta.url))));
});

async function render(pathname = "/") {
  return testWorker.fetch(pathname, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
}

test("requires a server session at reconstructed business routes", async () => {
  for (const pathname of [
    "/replica",
    "/replica/orders",
    "/replica/link-order/v2",
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 303, pathname);
    assert.match(response.headers.get("location"), /\/sign-in/);
  }
  const home = await render();
  assert.ok([302, 303, 307, 308].includes(home.status));
  assert.match(home.headers.get("location"), /\/replica$/);
});

test("server-renders the finished ORDERFLOW landing page", async () => {
  const response = await render("/overview");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ORDERFLOW/);
  assert.match(html, /주문은 더 쉽게/);
  assert.match(html, /고객 주문서 보기/);
  assert.doesNotMatch(
    html,
    /codex-preview|Your site is taking shape|react-loading-skeleton/i,
  );
});

test("ships product metadata and removes disposable starter assets", async () => {
  const [layout, page, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/overview/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /og\.webp/);
  assert.match(layout, /주문은 더 쉽게, 운영은 더 우아하게/);
  assert.match(page, /order\/fresh-market/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.webp", import.meta.url));
  await access(
    new URL("../public/visuals/orderflow-mark.webp", import.meta.url),
  );
  assert.doesNotMatch(
    `${layout}\n${page}`,
    /chatgpt\.site|signin-with-chatgpt|site-creator/i,
  );
});

test("keeps familiar bulk order workflows on the new authenticated API", async () => {
  const [workbench, orderRoute, orderForm] = await Promise.all([
    readFile(
      new URL("../app/admin/orders-workbench.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/admin/orders/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/order/[slug]/order-form.tsx", import.meta.url),
      "utf8",
    ),
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
    readFile(
      new URL("../app/admin/demo-admin-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/overview/page.tsx", import.meta.url), "utf8"),
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
