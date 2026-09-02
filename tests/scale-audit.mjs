import { performance } from "node:perf_hooks";

const baseUrl = process.env.BASE_URL ?? "http://localhost:8788";
const mode = process.argv[2] ?? "wave";
const requestCount = Number(process.argv[3] ?? "50");
const itemCount = Number(process.argv[4] ?? "20");
const offset = Number(process.argv[5] ?? "0");

if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 5000) throw new Error("requestCount must be between 1 and 5000");
if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 30) throw new Error("itemCount must be between 1 and 30");
if (!["wave", "contention", "idempotency"].includes(mode)) throw new Error("mode must be wave, contention, or idempotency");

const percentile = (sorted, fraction) => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(1)) : null;
const simulatedIp = (index) => `10.${Math.floor((index + 1) / 65536) % 250}.${Math.floor((index + 1) / 256) % 256}.${((index + 1) % 254) + 1}`;
const phone = (index) => `010${String(index + 1).padStart(8, "0").slice(-8)}`;

function payload(index) {
  const idempotencyKey = mode === "idempotency" ? "load-idempotency-fixed-0001" : `load-${String(index).padStart(8, "0")}-${crypto.randomUUID()}`;
  const items = mode === "contention"
    ? [{ productId: "load-contended", quantity: 1 }]
    : mode === "idempotency"
      ? [{ productId: "load-prod-01", quantity: 20 }]
      : Array.from({ length: itemCount }, (_, productIndex) => ({ productId: `load-prod-${String(productIndex + 1).padStart(2, "0")}`, quantity: 1 }));
  const userIndex = mode === "idempotency" ? offset : index;
  return {
    formSlug: "fresh-market", customerName: `부하검증-${userIndex}`, phone: phone(userIndex),
    deliveryMethod: "pickup", postalCode: "", address: "", addressDetail: "",
    requestNote: "격리된 로컬 D1 부하검증", paymentMethod: "pickup", agreed: true,
    website: "", idempotencyKey, items,
  };
}

async function submit(index) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const headers = { "content-type": "application/json", origin: baseUrl, "user-agent": `orderflow-scale-audit/${index}` };
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) headers["cf-connecting-ip"] = simulatedIp(index);
    const response = await fetch(`${baseUrl}/api/public/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload(index)), signal: controller.signal,
    });
    const bodyText = await response.text();
    let body;
    try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText.slice(0, 160) }; }
    return { status: response.status, elapsedMs: performance.now() - started, replayed: body?.replayed === true, error: typeof body?.error === "string" ? body.error : null };
  } catch (error) {
    return { status: 0, elapsedMs: performance.now() - started, replayed: false, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}

const wallStarted = performance.now();
const results = await Promise.all(Array.from({ length: requestCount }, (_, index) => submit(offset + index)));
const wallMs = performance.now() - wallStarted;
const durations = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
const statusCounts = Object.fromEntries([...new Set(results.map((result) => result.status))].sort((a, b) => a - b).map((status) => [String(status), results.filter((result) => result.status === status).length]));
console.log(JSON.stringify({
  mode, requests: requestCount, itemsPerOrder: mode === "wave" ? itemCount : 1,
  wallMs: Number(wallMs.toFixed(1)), throughputPerSecond: Number((requestCount / (wallMs / 1000)).toFixed(2)),
  latencyMs: { min: Number(durations[0].toFixed(1)), p50: percentile(durations, .5), p95: percentile(durations, .95), p99: percentile(durations, .99), max: Number(durations.at(-1).toFixed(1)) },
  statusCounts, replayed: results.filter((result) => result.replayed).length,
  errorSamples: [...new Set(results.map((result) => result.error).filter(Boolean))].slice(0, 5),
}, null, 2));
