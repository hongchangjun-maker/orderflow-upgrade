import { requireAdminApi } from "../../../lib/auth";
import { ensureDatabase, jsonError } from "../../../lib/data";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "../../../modules/customers/segments";

const segmentNames = new Set<CustomerSegment>(Object.keys(CUSTOMER_SEGMENTS) as CustomerSegment[]);
const customerSegmentSql = (alias: string) => `CASE
  WHEN ${alias}.order_count >= 10 OR ${alias}.total_spent >= 500000 THEN 'vip'
  WHEN ${alias}.last_ordered_at IS NULL OR julianday(${alias}.last_ordered_at) < julianday('now', '-90 days') THEN 'inactive'
  WHEN ${alias}.order_count >= 3 THEN 'regular'
  WHEN ${alias}.order_count <= 1 AND julianday(${alias}.last_ordered_at) >= julianday('now', '-30 days') THEN 'new'
  ELSE 'occasional'
END`;

export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  try {
    const db = await ensureDatabase();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const requestedSegment = url.searchParams.get("segment") ?? "all";
    const segment = segmentNames.has(requestedSegment as CustomerSegment) ? requestedSegment as CustomerSegment : "all";
    const cursor = (url.searchParams.get("cursor") ?? "").trim().slice(0, 130);
    const segmentSql = customerSegmentSql("c");
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query) {
      const like = `%${query}%`;
      clauses.push("(c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)");
      params.push(like, like, like);
    }
    if (segment !== "all") {
      clauses.push(`${segmentSql} = ?`);
      params.push(segment);
    }
    const [cursorDate, cursorId] = cursor.split("|");
    if (cursorDate && cursorId && /^(?:0000|\d{4}-\d{2}-\d{2}T)/u.test(cursorDate) && /^[a-zA-Z0-9-]{8,80}$/u.test(cursorId)) {
      clauses.push("(COALESCE(c.last_ordered_at, '0000') < ? OR (COALESCE(c.last_ordered_at, '0000') = ? AND c.id < ?))");
      params.push(cursorDate, cursorDate, cursorId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows, summary] = await Promise.all([
      db.prepare(`
        SELECT c.id, c.name, c.phone, c.address, c.order_count AS orderCount,
          c.total_spent AS totalSpent, c.points, c.last_ordered_at AS lastOrderedAt,
          ${segmentSql} AS segment
        FROM customers c ${where}
        ORDER BY COALESCE(c.last_ordered_at, '0000') DESC, c.id DESC LIMIT 61
      `).bind(...params).all(),
      db.prepare(`
        WITH segmented AS (SELECT ${segmentSql} AS segment FROM customers c)
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN segment = 'vip' THEN 1 ELSE 0 END) AS vip,
          SUM(CASE WHEN segment = 'regular' THEN 1 ELSE 0 END) AS regular,
          SUM(CASE WHEN segment = 'new' THEN 1 ELSE 0 END) AS new,
          SUM(CASE WHEN segment = 'inactive' THEN 1 ELSE 0 END) AS inactive,
          SUM(CASE WHEN segment = 'occasional' THEN 1 ELSE 0 END) AS occasional
        FROM segmented
      `).first(),
    ]);
    const hasMore = rows.results.length > 60;
    const customers = rows.results.slice(0, 60);
    const last = customers.at(-1) as { lastOrderedAt?: string | null; id?: string } | undefined;
    const nextCursor = hasMore && last?.id ? `${last.lastOrderedAt ?? "0000"}|${last.id}` : null;
    return Response.json({ customers, summary, nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
