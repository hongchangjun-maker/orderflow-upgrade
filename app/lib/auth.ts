import { env } from "cloudflare:workers";
import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";

function runtimeValue(key: string): string {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return workerEnv[key] ?? process.env[key] ?? "";
}

function isLocalBypassEnabled() {
  return runtimeValue("LOCAL_ADMIN_BYPASS") === "1";
}

function allowedEmails() {
  return runtimeValue("ADMIN_EMAILS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function getAdminUser(): Promise<ChatGPTUser | null> {
  if (isLocalBypassEnabled()) {
    return {
      userId: "local-owner",
      displayName: "운영자",
      email: "local@orderflow.test",
      fullName: "운영자",
    };
  }

  const user = await getChatGPTUser();
  if (!user) return null;
  const allowlist = allowedEmails();
  if (allowlist.length === 0 || !allowlist.includes(user.email.toLowerCase())) return null;
  return user;
}

export async function requireAdminApi(): Promise<ChatGPTUser | Response> {
  const user = await getAdminUser();
  if (user) return user;
  return Response.json(
    { error: "관리자 인증이 필요합니다." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
