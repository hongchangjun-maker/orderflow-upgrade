import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const settings = await db.prepare(`SELECT name, tagline, phone, payment_guide AS paymentGuide, order_complete_message AS orderCompleteMessage FROM shops WHERE id = 'main'`).first();
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const value = (key: string, max: number) => typeof payload[key] === "string" ? payload[key].trim().slice(0, max) : "";
    const name = value("name", 80);
    if (!name) return Response.json({ error: "상점명을 입력해 주세요." }, { status: 400 });
    const db = await ensureDatabase();
    await db.prepare(`UPDATE shops SET name = ?, tagline = ?, phone = ?, payment_guide = ?, order_complete_message = ?, updated_at = ? WHERE id = 'main'`).bind(name, value("tagline", 160), value("phone", 30), value("paymentGuide", 300), value("orderCompleteMessage", 300), new Date().toISOString()).run();
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
