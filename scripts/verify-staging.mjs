import { spawn } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {verifyReplicaAssets} from './verify-replica-assets.mjs';
const cli = new URL(
  "../node_modules/wrangler/bin/wrangler.js",
  import.meta.url,
);
const run = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(cli), ...args], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.end(input);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Wrangler exited ${code}`)),
    );
  });
const config = ["--config", "wrangler.staging.jsonc"];
await run([
  "d1",
  "migrations",
  "apply",
  "orderflow-upgrade-staging-db",
  "--remote",
  ...config,
]);
const password = randomBytes(30).toString("base64url"),
  salt = randomBytes(16);
const hash = `pbkdf2_sha256$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
const runTag=Date.now();
const emails = [`qa-owner-${runTag}@orderflow.invalid`, `qa-second-${runTag}@orderflow.invalid`];
await run(
  ["secret", "bulk", ...config],
  JSON.stringify({
    ADMIN_EMAILS: emails.join(","),
    ADMIN_PASSWORD_HASH: hash,
    ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url"),
  }),
);
await run(["deploy", "--keep-vars", ...config]);
const base = "https://orderflow-korea-upgrade-staging.hhongcjun.workers.dev";
await verifyReplicaAssets(base);
async function login(email) {
  const response = await fetch(base + "/api/replica/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-orderflow-request": "1" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200)
    throw new Error(`Staging login failed ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
const cookie = await login(emails[0]),
  second = await login(emails[1]);
const call = async (path, cookie, body) => {
  const r = await fetch(base + "/api/replica" + path, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      "Content-Type": "application/json",
      "x-orderflow-request": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json()) };
};
const form = await call("/workspace/form", cookie, {
  title: "Tenant isolation verification",
  itemsText: "격리 검증용|개|1000|100",
});
if (form.status !== 200) throw new Error("Could not create isolation fixture");
if (
  (await call(`/urlorders/setting/${form.data.int_value1}`, second)).status !==
  404
)
  throw new Error("Tenant isolation failed");
if ((await call("/session", "")).status !== 401)
  throw new Error("Unauthenticated session accepted");
console.log("PASS staging tenant isolation and real authentication");
process.env.LIVE_TEST_URL = base;
process.env.LIVE_TEST_COOKIE = cookie;
process.env.LIVE_LOAD??='300';
await import("../tests/live-http.mjs");
const {runParity}=await import("../tests/parity-http.mjs");
await runParity(base,cookie,{email:emails[0],password});
