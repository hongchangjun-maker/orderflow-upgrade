import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";
import { validateMutationRequest } from "../../../lib/security";
import { canTransitionDeliveryRun, deliveryRunStatuses, deliveryStopStatuses, validateDeliveryRunDraft, type DeliveryRunStatus, type DeliveryStopStatus } from "../../../modules/operations/domain";

const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/u.test(value);

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const [candidates, runRows] = await Promise.all([
      db.prepare(`
        SELECT o.id, o.order_no AS orderNo, o.customer_name AS customerName, o.customer_phone AS customerPhone,
          o.address, o.address_detail AS addressDetail, o.status, o.total, o.created_at AS createdAt
        FROM orders o LEFT JOIN delivery_stops ds ON ds.order_id = o.id
        WHERE o.delivery_method = 'delivery' AND o.status IN ('confirmed','packing','shipping') AND ds.id IS NULL
        ORDER BY o.created_at ASC LIMIT 100
      `).all(),
      db.prepare(`
        SELECT dr.id, dr.service_date AS serviceDate, dr.title, dr.status, dr.created_by AS createdBy,
          dr.started_at AS startedAt, dr.completed_at AS completedAt, dr.created_at AS createdAt,
          COUNT(ds.id) AS stopCount,
          SUM(CASE WHEN ds.status = 'delivered' THEN 1 ELSE 0 END) AS deliveredCount,
          SUM(CASE WHEN ds.status = 'failed' THEN 1 ELSE 0 END) AS failedCount
        FROM delivery_runs dr LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
        GROUP BY dr.id ORDER BY dr.service_date DESC, dr.created_at DESC LIMIT 20
      `).all(),
    ]);
    const runs = runRows.results as Array<{ id: string }>;
    let stops: unknown[] = [];
    if (runs.length) {
      const placeholders = runs.map(() => "?").join(",");
      const result = await db.prepare(`
        SELECT ds.id, ds.run_id AS runId, ds.order_id AS orderId, ds.sequence, ds.status, ds.note,
          o.order_no AS orderNo, o.customer_name AS customerName, o.customer_phone AS customerPhone,
          o.address, o.address_detail AS addressDetail, o.total
        FROM delivery_stops ds JOIN orders o ON o.id = ds.order_id
        WHERE ds.run_id IN (${placeholders}) ORDER BY ds.run_id, ds.sequence
      `).bind(...runs.map((run) => run.id)).all();
      stops = result.results;
    }
    return Response.json({ candidates: candidates.results, runs, stops }, { headers: { "Cache-Control": "no-store" } });
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
    const draft = validateDeliveryRunDraft(await request.json());
    const db = await ensureDatabase();
    const placeholders = draft.orderIds.map(() => "?").join(",");
    const eligible = await db.prepare(`
      SELECT o.id FROM orders o LEFT JOIN delivery_stops ds ON ds.order_id = o.id
      WHERE o.id IN (${placeholders}) AND o.delivery_method = 'delivery'
        AND o.status IN ('confirmed','packing','shipping') AND ds.id IS NULL
    `).bind(...draft.orderIds).all();
    if (eligible.results.length !== draft.orderIds.length) {
      return Response.json({ error: "선택한 주문 중 배송 작업에 추가할 수 없는 주문이 있습니다." }, { status: 409 });
    }
    const now = new Date().toISOString();
    const runId = `run-${crypto.randomUUID()}`;
    const statements = [
      db.prepare(`INSERT INTO delivery_runs (id, service_date, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'planned', ?, ?, ?)`).bind(runId, draft.serviceDate, draft.title, admin.email, now, now),
      ...draft.orderIds.map((orderId, index) => db.prepare(`INSERT INTO delivery_stops (id, run_id, order_id, sequence, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', ?, ?)`).bind(`stop-${crypto.randomUUID()}`, runId, orderId, index + 1, now, now)),
      db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('delivery.run.created', ?, ?, ?)`).bind(`${draft.title} 배송 작업 ${draft.orderIds.length}건 생성`, admin.email, now),
    ];
    await db.batch(statements);
    return Response.json({ ok: true, id: runId }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /배송|주문/u.test(error.message)) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /UNIQUE constraint failed: delivery_stops\.order_id/u.test(error.message)) {
      return Response.json({ error: "선택한 주문이 다른 배송 작업에 먼저 추가되었습니다. 목록을 새로고침해 주세요." }, { status: 409 });
    }
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const invalid = validateMutationRequest(request);
  if (invalid) return invalid;
  try {
    const payload = await request.json() as { action?: string; runId?: string; stopId?: string; status?: string; note?: string };
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    if (payload.action === "run-status") {
      if (!validId(payload.runId) || !deliveryRunStatuses.has(payload.status as DeliveryRunStatus)) return Response.json({ error: "배송 작업 상태를 확인해 주세요." }, { status: 400 });
      const current = await db.prepare(`SELECT status FROM delivery_runs WHERE id = ? LIMIT 1`).bind(payload.runId).first<{ status: DeliveryRunStatus }>();
      if (!current) return Response.json({ error: "배송 작업을 찾을 수 없습니다." }, { status: 404 });
      if (!canTransitionDeliveryRun(current.status, payload.status as DeliveryRunStatus)) {
        return Response.json({ error: "이미 끝난 배송 작업의 상태는 되돌릴 수 없습니다." }, { status: 409 });
      }
      if (payload.status === "completed") {
        const unresolved = await db.prepare(`SELECT COUNT(*) AS count FROM delivery_stops WHERE run_id = ? AND status IN ('waiting','out_for_delivery','held')`).bind(payload.runId).first<{ count: number }>();
        if (Number(unresolved?.count ?? 0) > 0) return Response.json({ error: "대기·배송 중·보류 배송지를 먼저 처리해 주세요." }, { status: 409 });
      }
      const startedAt = payload.status === "running" ? now : null;
      const completedAt = payload.status === "completed" ? now : null;
      const result = await db.prepare(`UPDATE delivery_runs SET status = ?, started_at = COALESCE(started_at, ?), completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?`).bind(payload.status, startedAt, completedAt, now, payload.runId).run();
      if (!result.meta.changes && current.status !== payload.status) return Response.json({ error: "배송 작업을 갱신하지 못했습니다." }, { status: 409 });
      if (payload.status === "running") {
        await db.prepare(`UPDATE orders SET status = 'shipping', updated_at = ? WHERE id IN (SELECT order_id FROM delivery_stops WHERE run_id = ?) AND status NOT IN ('done','cancelled')`).bind(now, payload.runId).run();
      }
      await db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('delivery.run.status', ?, ?, ?)`).bind(`배송 작업 상태를 ${payload.status}(으)로 변경`, admin.email, now).run();
      return Response.json({ ok: true });
    }
    if (payload.action === "stop-status") {
      if (!validId(payload.stopId) || !deliveryStopStatuses.has(payload.status as DeliveryStopStatus)) return Response.json({ error: "배송지 상태를 확인해 주세요." }, { status: 400 });
      const stop = await db.prepare(`SELECT order_id AS orderId FROM delivery_stops WHERE id = ? LIMIT 1`).bind(payload.stopId).first<{ orderId: string }>();
      if (!stop) return Response.json({ error: "배송지를 찾을 수 없습니다." }, { status: 404 });
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
      const completedAt = payload.status === "delivered" || payload.status === "failed" ? now : null;
      await db.batch([
        db.prepare(`UPDATE delivery_stops SET status = ?, note = ?, completed_at = ?, updated_at = ? WHERE id = ?`).bind(payload.status, note, completedAt, now, payload.stopId),
        db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status != 'cancelled'`).bind(payload.status === "delivered" ? "done" : "shipping", now, stop.orderId),
        db.prepare(`INSERT INTO activity_logs (action, summary, actor, created_at) VALUES ('delivery.stop.status', ?, ?, ?)`).bind(`배송지 상태를 ${payload.status}(으)로 변경`, admin.email, now),
      ]);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "지원하지 않는 배송 작업입니다." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
