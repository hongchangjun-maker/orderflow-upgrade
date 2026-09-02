import { env } from "cloudflare:workers";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function runtimeValue(key: string): string {
  const workerValue: unknown = Reflect.get(env, key);
  if (typeof workerValue === "string") return workerValue;
  const processValue: unknown = Reflect.get(process.env, key);
  return typeof processValue === "string" ? processValue : "";
}

export function validateMutationRequest(request: Request, maxBytes = 65_536): Response | null {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > maxBytes) {
    return Response.json({ error: "요청 내용이 너무 큽니다." }, { status: 413 });
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json({ error: "JSON 형식의 요청만 허용됩니다." }, { status: 415 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
  }
  return null;
}

export async function scopedFingerprint(request: Request, scope: string): Promise<string> {
  const value = [scope, request.headers.get("cf-connecting-ip") ?? "local", request.headers.get("user-agent") ?? "unknown"].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deterministicId(namespace: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${namespace}:${value}`));
  const hex = Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${namespace}-${hex}`;
}
