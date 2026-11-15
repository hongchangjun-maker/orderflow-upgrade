import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = resolve(root, "app/modules/live");
const owners = {
  domain: "domain",
  schedule: "domain",
  html: "html-safety",
  store: "persistence",
  context: "authorization",
  accounts: "identity",
  forms: "catalog",
  orders: "orders",
  customers: "ledger-customers",
  operations: "dispatch-schedules",
  communications: "chat-messaging",
  media: "media-storage",
  dashboard: "reporting",
  router: "http-composition",
  "public-api": "public-http",
};
const graph = new Map();
for (const file of await readdir(server)) {
  if (!file.endsWith(".ts")) continue;
  const name = basename(file, ".ts"),
    source = await readFile(resolve(server, file), "utf8");
  if (!owners[name]) throw new Error(`Unowned server module: ${file}`);
  if (source.split("\n").length > 900)
    throw new Error(`Review responsibility size: ${file}`);
  if (
    owners[name] === "domain" &&
    /\bfetch\s*\(|cloudflare:|node:|\bD1Database\b|localStorage|from ['"]react/u.test(
      source,
    )
  )
    throw new Error(`Domain platform dependency: ${file}`);
  const edges = [];
  for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/gu)) {
    const target = resolve(dirname(resolve(server, file)), match[1]).replace(
      /\.ts$/u,
      "",
    );
    if (target.startsWith(server)) edges.push(basename(target));
  }
  graph.set(name, edges);
}
const active = new Set(),
  done = new Set();
function visit(name) {
  if (active.has(name))
    throw new Error(
      `Runtime/type dependency cycle: ${[...active, name].join(" -> ")}`,
    );
  if (done.has(name)) return;
  active.add(name);
  for (const edge of graph.get(name) ?? []) visit(edge);
  active.delete(name);
  done.add(name);
}
for (const name of graph.keys()) visit(name);
for (const directory of ["app/live-ui", "app/workspace", "app/sign-in"])
  for (const file of await readdir(resolve(root, directory))) {
    if (!file.endsWith(".tsx")) continue;
    const source = await readFile(resolve(root, directory, file), "utf8");
    if (
      source.includes('"use client"') &&
      (/\bfetch\s*\(/u.test(source) ||
        /modules\/live\//u.test(source) ||
        /cloudflare:|drizzle-orm/u.test(source))
    )
      throw new Error(
        `UI bypasses application HTTP port: ${directory}/${file}`,
      );
  }
console.log(
  `PASS ${graph.size} owned modules; no runtime/type cycles; pure rules and UI network boundaries`,
);
