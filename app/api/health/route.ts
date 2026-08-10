import { ensureDatabase } from "../../lib/data";
import { runtimeValue } from "../../lib/security";

export async function GET() {
  try {
    const db = await ensureDatabase();
    await db.prepare("SELECT 1 AS ok").first();
    return Response.json({ status: "ok", database: "connected", environment: runtimeValue("ENVIRONMENT") || "sites" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
