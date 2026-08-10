import { ensureDatabase } from "../../lib/data";
import { runtimeValue } from "../../lib/security";

export async function GET() {
  try {
    const db = await ensureDatabase();
    await db.prepare("SELECT 1 AS ok").first();
    const authConfigured = Boolean(
      runtimeValue("ADMIN_EMAILS") &&
      runtimeValue("ADMIN_PASSWORD_HASH") &&
      runtimeValue("ADMIN_SESSION_SECRET"),
    );
    return Response.json({ status: "ok", database: "connected", environment: runtimeValue("ENVIRONMENT") || "cloudflare", authConfigured }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
