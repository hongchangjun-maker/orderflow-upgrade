import { env } from "cloudflare:workers";

export function getD1() {
  if (!env.DB) throw new Error("D1 데이터베이스가 연결되지 않았습니다.");
  return env.DB;
}

// Schema and seed work belongs in versioned migrations. Keeping the request
// hot path to one binding lookup prevents every API request from issuing DDL.
export async function ensureDatabase() {
  return getD1();
}

export async function fingerprintRequest(request: Request, scope = "") {
  const raw = `${scope}|${request.headers.get("cf-connecting-ip") ?? "local"}|${request.headers.get("user-agent") ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function jsonError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  console.error(JSON.stringify({ event: "request_error", message }));
  if (message.includes("insufficient_stock")) {
    return Response.json({ error: "주문 중 재고가 변경되었습니다. 수량을 다시 확인해 주세요.", code: "insufficient_stock" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (/overloaded|SQLITE_BUSY|database is locked/i.test(message)) {
    return Response.json({ error: "요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.", code: "temporarily_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
  }
  return Response.json({ error: fallback, code: "internal_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
