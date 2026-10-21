import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";
import { runtimeValue, validateMutationRequest } from "../../../lib/security";
import { applyAdvertisingRules, messageBytes, type MessageKind } from "../../../modules/messages/templates";

const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{3,80}$/u.test(value);

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const [templates, outbox] = await Promise.all([
      db.prepare(`SELECT id, name, kind, body, active, updated_at AS updatedAt FROM message_templates ORDER BY active DESC, updated_at DESC LIMIT 100`).all(),
      db.prepare(`SELECT id, template_id AS templateId, recipient_name AS recipientName, recipient_phone AS recipientPhone, body, status, provider, created_at AS createdAt FROM message_outbox ORDER BY created_at DESC LIMIT 50`).all(),
    ]);
    const providerConfigured = Boolean(runtimeValue("SMS_PROVIDER") && runtimeValue("SMS_API_KEY"));
    return Response.json({ templates: templates.results, outbox: outbox.results, providerConfigured }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const invalid = validateMutationRequest(request);
  if (invalid) return invalid;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    if (payload.action === "template") {
      const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 80) : "";
      const kind: MessageKind = payload.kind === "AD" ? "AD" : "INFO";
      let body = typeof payload.body === "string" ? payload.body.trim().slice(0, 2000) : "";
      if (!name || !body) return Response.json({ error: "템플릿 이름과 내용을 입력해 주세요." }, { status: 400 });
      if (kind === "AD") body = applyAdvertisingRules(body);
      const id = validId(payload.id) ? payload.id : `tpl-${crypto.randomUUID()}`;
      await db.prepare(`
        INSERT INTO message_templates (id, name, kind, body, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, body = excluded.body, active = 1, updated_at = excluded.updated_at
      `).bind(id, name, kind, body, now, now).run();
      await db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('message.template.saved', ?, ?, ?)`).bind(`메시지 템플릿 '${name}' 저장`, admin.email, now).run();
      return Response.json({ ok: true, id, bytes: messageBytes(body) });
    }
    if (payload.action === "draft") {
      const recipientName = typeof payload.recipientName === "string" ? payload.recipientName.trim().slice(0, 80) : "";
      const recipientPhone = typeof payload.recipientPhone === "string" ? payload.recipientPhone.replace(/\D/gu, "").slice(0, 12) : "";
      const body = typeof payload.body === "string" ? payload.body.trim().slice(0, 2000) : "";
      if (!recipientName || !/^0\d{9,10}$/u.test(recipientPhone) || !body) return Response.json({ error: "받는 분, 휴대폰 번호, 내용을 확인해 주세요." }, { status: 400 });
      const id = `msg-${crypto.randomUUID()}`;
      await db.batch([
        db.prepare(`INSERT INTO message_outbox (id, template_id, recipient_name, recipient_phone, body, status, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', 'unconfigured', ?, ?)`).bind(id, validId(payload.templateId) ? payload.templateId : null, recipientName, recipientPhone, body, now, now),
        db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('message.draft.created', ?, ?, ?)`).bind(`${recipientName} 고객 메시지 초안 저장`, admin.email, now),
      ]);
      return Response.json({ ok: true, id, status: "draft", bytes: messageBytes(body), providerConfigured: false }, { status: 201 });
    }
    return Response.json({ error: "지원하지 않는 메시지 작업입니다." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
