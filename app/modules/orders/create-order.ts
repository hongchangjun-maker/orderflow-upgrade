import { ensureDatabase, fingerprintRequest } from "../../lib/data";
import { deterministicId, sha256Hex } from "../../lib/security";
import { canonicalOrderRequest, normalizeOrderPayload, OrderInputError, priceOrder, type OrderPayload } from "./domain";
import { commitOrder, findOrderByIdempotency, isRetryableD1Error, isStockConflict, loadOrderCatalog, loadSubmissionGate, type StoredOrder } from "./repository";

export type CreateOrderResult = {
  body: { order: Pick<StoredOrder, "id" | "orderNo" | "total" | "status">; replayed?: boolean };
  status: number;
  headers?: Record<string, string>;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function replayResult(order: StoredOrder, requestHash: string): CreateOrderResult {
  if (order.requestHash && order.requestHash !== requestHash) {
    throw new OrderInputError("같은 주문 식별값으로 다른 내용이 전송되었습니다. 주문 화면을 새로고침해 주세요.", 409, "idempotency_conflict");
  }
  return {
    body: { order: { id: order.id, orderNo: order.orderNo, total: Number(order.total), status: order.status }, replayed: true },
    status: 200,
    headers: { "Cache-Control": "no-store" },
  };
}

export async function createOrder(request: Request, payload: OrderPayload): Promise<CreateOrderResult> {
  const order = normalizeOrderPayload(payload);
  const requestHash = await sha256Hex(canonicalOrderRequest(order));
  const db = await ensureDatabase();
  const fingerprint = await fingerprintRequest(request, `${order.formSlug}|${order.phone}`);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const gate = await loadSubmissionGate(db, order.idempotencyKey, fingerprint, oneHourAgo);
  if (gate?.id) return replayResult(gate, requestHash);
  if (Number(gate?.recentCount ?? 0) >= 8) {
    throw new OrderInputError("짧은 시간에 주문 요청이 많습니다. 1분 뒤 다시 시도해 주세요.", 429, "rate_limited");
  }

  const catalog = await loadOrderCatalog(db, order.formSlug, order.items.map((item) => item.productId));
  if (!catalog) throw new OrderInputError("현재 주문할 수 없는 주문서입니다.", 404, "form_unavailable");
  const priced = priceOrder(order, catalog);
  const now = new Date().toISOString();
  const dateCode = now.slice(2, 10).replaceAll("-", "");
  const orderId = crypto.randomUUID();
  const orderNo = `OF-${dateCode}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const customerId = await deterministicId("customer", order.phone);
  const commitInput = { order, priced, formId: catalog.id, customerId, orderId, orderNo, requestHash, fingerprint, now };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await commitOrder(db, commitInput);
      console.log(JSON.stringify({ event: "order_created", orderId, formId: catalog.id, itemCount: priced.items.length, total: priced.total }));
      return {
        body: { order: { id: orderId, orderNo, total: priced.total, status: "new" } },
        status: 201,
        headers: { "Cache-Control": "no-store" },
      };
    } catch (error) {
      lastError = error;
      for (let replayAttempt = 0; replayAttempt < 3; replayAttempt += 1) {
        const existing = await findOrderByIdempotency(db, order.idempotencyKey);
        if (existing) return replayResult(existing, requestHash);
        if (replayAttempt < 2) await sleep(15 * (replayAttempt + 1) + Math.floor(Math.random() * 10));
      }
      if (isStockConflict(error)) {
        throw new OrderInputError("주문 중 재고가 변경되었습니다. 상품 수량을 새로 확인해 주세요.", 409, "insufficient_stock");
      }
      if (!isRetryableD1Error(error) || attempt === 2) break;
      await sleep(40 * (2 ** attempt) + Math.floor(Math.random() * 40));
    }
  }

  if (isRetryableD1Error(lastError)) {
    console.warn(JSON.stringify({ event: "order_overloaded", formId: catalog.id, itemCount: priced.items.length }));
    throw new OrderInputError("주문이 몰리고 있습니다. 잠시 후 다시 제출해 주세요.", 503, "temporarily_unavailable");
  }
  throw lastError;
}
