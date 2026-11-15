import { LiveError, obj, type Doc } from "./domain";
export type LiveContext = {
  db: D1Database;
  shop: string;
  actor: string;
  role: string;
  permissions: Doc;
  origin: string;
};
export const now = () => new Date().toISOString();
export const parse = (s: unknown): Doc => {
  try {
    return obj(JSON.parse(String(s ?? "{}")));
  } catch {
    return {};
  }
};
export async function transaction(
  c: LiveContext,
  statements: D1PreparedStatement[],
  checks: Array<{
    sql: string;
    values: unknown[];
  }> = [],
) {
  const key = crypto.randomUUID();
  // Separate guard statements avoid D1's per-statement parameter limit.
  const prefix = checks.map((g, i) =>
    c.db
      .prepare(
        `INSERT INTO of_guards(id,ok) VALUES(?,CASE WHEN (${g.sql}) THEN 1 ELSE 0 END)`,
      )
      .bind(`${key}:${i}`, ...g.values),
  );
  try {
    return await c.db.batch([
      ...prefix,
      ...statements,
      ...(checks.length
        ? [
            c.db
              .prepare("DELETE FROM of_guards WHERE id LIKE ?")
              .bind(`${key}:%`),
          ]
        : []),
    ]);
  } catch (error) {
    if (String(error).includes("ok=1") || String(error).includes("of_guards"))
      throw new LiveError(
        "다른 요청이 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.",
        409,
        "revision_conflict",
      );
    throw error;
  }
}
export async function query<T = Doc>(
  c: LiveContext,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  const result = await c.db
    .prepare(sql)
    .bind(...values)
    .all<T>();
  return result.results;
}
export async function first<T = Doc>(
  c: LiveContext,
  sql: string,
  ...values: unknown[]
) {
  return c.db
    .prepare(sql)
    .bind(...values)
    .first<T>();
}
export async function audit(c: LiveContext, kind: string, entity: unknown) {
  await c.db
    .prepare(
      "INSERT INTO of_changes(shop,kind,entity,actor,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(c.shop, kind, String(entity), c.actor, now())
    .run();
}
export async function list(c: LiveContext, kind: string): Promise<Doc[]> {
  const result = await query(
    c,
    "SELECT id,data,revision,created_at,updated_at FROM of_records WHERE shop=? AND kind=? AND deleted=0 ORDER BY id DESC LIMIT 2000",
    c.shop,
    kind,
  );
  return result.map((r) => ({
    ...parse(r.data),
    id: r.id,
    seqno: r.id,
    revision: r.revision,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}
export async function put(c: LiveContext, kind: string, data: Doc, id = 0) {
  if (JSON.stringify(data).length > 200000)
    throw new LiveError("저장 내용이 너무 큽니다.", 413);
  const time = now();
  let key = id;
  if (id) {
    const old = await first(
      c,
      "SELECT revision FROM of_records WHERE id=? AND shop=? AND kind=? AND deleted=0",
      id,
      c.shop,
      kind,
    );
    if (!old) throw new LiveError("자료를 찾을 수 없습니다.", 404);
    if (data.revision != null && Number(data.revision) !== Number(old.revision))
      throw new LiveError(
        "다른 사용자가 먼저 수정했습니다. 새로고침해 주세요.",
        409,
        "revision_conflict",
      );
    const result = await c.db
      .prepare(
        "UPDATE of_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND shop=? AND kind=? AND revision=?",
      )
      .bind(JSON.stringify(data), time, id, c.shop, kind, old.revision)
      .run();
    if (result.meta.changes !== 1)
      throw new LiveError("동시 수정 충돌입니다.", 409);
  } else {
    const result = await c.db
      .prepare(
        "INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .bind(c.shop, kind, JSON.stringify(data), time, time)
      .run();
    key = Number(result.meta.last_row_id);
  }
  await audit(c, kind, key);
  const saved = await first(
    c,
    "SELECT id,data,revision,created_at,updated_at FROM of_records WHERE shop=? AND kind=? AND id=? AND deleted=0",
    c.shop,
    kind,
    key,
  );
  if (!saved) throw new LiveError("저장한 자료를 읽을 수 없습니다.", 500);
  return {
    ...parse(saved.data),
    id: saved.id,
    seqno: saved.id,
    revision: saved.revision,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
  } as Doc;
}
export async function remove(c: LiveContext, kind: string, id: number) {
  const r = await c.db
    .prepare(
      "UPDATE of_records SET deleted=1,updated_at=? WHERE shop=? AND kind=? AND id=?",
    )
    .bind(now(), c.shop, kind, id)
    .run();
  if (!r.meta.changes) throw new LiveError("자료를 찾을 수 없습니다.", 404);
  await audit(c, kind, id);
  return { deleted: 1 };
}
export async function setting(c: LiveContext, name: string, value?: Doc) {
  if (value) {
    await c.db
      .prepare(
        "UPDATE of_shops SET settings=json_set(settings,?,json(?)) WHERE id=?",
      )
      .bind(`$.${JSON.stringify(name)}`, JSON.stringify(value), c.shop)
      .run();
    await audit(c, "setting", name);
  }
  const shop = await first(
    c,
    "SELECT settings FROM of_shops WHERE id=?",
    c.shop,
  );
  return obj(parse(shop?.settings)[name]);
}
