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

export async function fingerprintRequest(request: Request) {
  const raw = `${request.headers.get("cf-connecting-ip") ?? "local"}|${request.headers.get("user-agent") ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function jsonError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  const message = error instanceof Error ? error.message : fallback;
  const safe = message.includes("insufficient_stock") ? "주문 중 재고가 변경되었습니다. 수량을 다시 확인해 주세요." : fallback;
  return Response.json({ error: safe }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
