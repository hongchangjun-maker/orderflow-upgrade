import { cookies } from "next/headers";
import { runtimeValue } from "./security";

export type AdminUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const SESSION_COOKIE = "orderflow_session";
const encoder = new TextEncoder();

function isLocalBypassEnabled() {
  return runtimeValue("LOCAL_ADMIN_BYPASS") === "1" && runtimeValue("ENVIRONMENT") !== "production";
}

export function allowedAdminEmails() {
  return runtimeValue("ADMIN_EMAILS").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createAdminSession(email: string): Promise<string> {
  const secret = runtimeValue("ADMIN_SESSION_SECRET");
  if (!secret) throw new Error("관리자 세션 비밀값이 설정되지 않았습니다.");
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + 12 * 60 * 60 * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${bytesToBase64Url(signature)}`;
}

async function verifyAdminSession(token: string): Promise<AdminUser | null> {
  const secret = runtimeValue("ADMIN_SESSION_SECRET");
  const [payload, signature] = token.split(".");
  if (!secret || !payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), ownedBuffer(base64UrlToBytes(signature)), encoder.encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { email?: string; exp?: number };
    const email = parsed.email?.trim().toLowerCase() ?? "";
    if (!email || !parsed.exp || parsed.exp <= Date.now() || !allowedAdminEmails().includes(email)) return null;
    return { userId: `admin:${email}`, displayName: "운영자", email, fullName: "운영자" };
  } catch {
    return null;
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expectedText] = runtimeValue("ADMIN_PASSWORD_HASH").split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 50_000 || iterations > 500_000 || !saltText || !expectedText) return false;
  try {
    const expected = base64UrlToBytes(expectedText);
    const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(base64UrlToBytes(saltText)), iterations }, passwordKey, expected.byteLength * 8));
    if (actual.byteLength !== expected.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < actual.byteLength; index += 1) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getAdminUser(): Promise<AdminUser | null> {
  if (isLocalBypassEnabled()) return { userId: "local-owner", displayName: "운영자", email: "local@orderflow.test", fullName: "운영자" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const sessionUser = await verifyAdminSession(token);
    if (sessionUser) return sessionUser;
  }
  return null;
}

export async function requireAdminApi(): Promise<AdminUser | Response> {
  const user = await getAdminUser();
  if (user) return user;
  return Response.json({ error: "관리자 인증이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
