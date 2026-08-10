import { allowedAdminEmails, createAdminSession, sessionCookie, verifyAdminPassword } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";
import { scopedFingerprint, validateMutationRequest } from "../../../lib/security";

export async function POST(request: Request) {
  const invalidRequest = validateMutationRequest(request, 8_192);
  if (invalidRequest) return invalidRequest;
  try {
    const payload = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 160) : "";
    const password = typeof payload.password === "string" ? payload.password.slice(0, 256) : "";
    const fingerprint = await scopedFingerprint(request, `admin-login:${email}`);
    const db = await ensureDatabase();
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM admin_login_attempts WHERE fingerprint = ? AND created_at >= ?`).bind(fingerprint, windowStart).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 5) return Response.json({ error: "로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요." }, { status: 429 });
    const valid = allowedAdminEmails().includes(email) && await verifyAdminPassword(password);
    if (!valid) {
      await db.prepare(`INSERT INTO admin_login_attempts (fingerprint, created_at) VALUES (?, ?)`).bind(fingerprint, new Date().toISOString()).run();
      return Response.json({ error: "이메일 또는 비밀번호를 확인해 주세요." }, { status: 401 });
    }
    const token = await createAdminSession(email);
    await db.batch([
      db.prepare(`DELETE FROM admin_login_attempts WHERE fingerprint = ?`).bind(fingerprint),
      db.prepare(`DELETE FROM admin_login_attempts WHERE created_at < ?`).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token) } });
  } catch (error) {
    return jsonError(error, "로그인하지 못했습니다.");
  }
}
