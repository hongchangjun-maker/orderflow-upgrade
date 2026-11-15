import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
test("source presentation is pinned; runtime talks only to independent authenticated API", async () => {
  const [app, runtime, worker, manifest, css] = await Promise.all(
    [
      "../public/replica-assets/application.js",
      "../public/replica-assets/runtime.mjs",
      "../worker/index.ts",
      "../public/replica-assets/provenance.json",
      "../public/replica-assets/reference.css",
    ].map((p) => readFile(new URL(p, import.meta.url), "utf8")),
  );
  assert.equal(
    createHash("sha256").update(app).digest("hex"),
    JSON.parse(manifest).outputSha256,
  );
  assert.match(app, /\$s\.defaults\.adapter=replicaAdapter/);
  assert.match(app, /basename:"\/replica"/);
  assert.doesNotMatch(app, /Notification\.requestPermission\(/);
  assert.doesNotMatch(
    app,
    /https:\/\/(?:xn--9y2bw0aj3kmoj8tj|xn--z92bu1i0sh|링크주문서)/,
  );
  assert.match(runtime, /const ROOT="\/api\/replica"/);
  assert.match(runtime, /parsed.origin!==location.origin/);
  assert.doesNotMatch(runtime, /model\.mjs|createOrders|localStorage\.setItem/);
  assert.match(runtime, /HTTPONLY-COOKIE-SESSION/);
  assert.match(worker, /connect-src 'self'/);
  assert.match(css, /#d65b13/i);
});
test("all server mutations require CSRF checks and tenant authority", async () => {
  const [router, context] = await Promise.all(
    ["../app/modules/live/router.ts", "../app/modules/live/context.ts"].map(
      (p) => readFile(new URL(p, import.meta.url), "utf8"),
    ),
  );
  assert.match(router, /x-orderflow-request/);
  assert.match(router, /origin !== url.origin/);
  assert.match(router, /await context\(request\)/);
  assert.match(router, /authorize\(c, path, method\)/);
  assert.match(context, /of_sessions/);
  assert.match(context, /PREPAY_POINT/);
});
