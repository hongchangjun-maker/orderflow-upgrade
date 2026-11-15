export type Doc = Record<string, unknown>;
export const obj = (v: unknown): Doc =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {};
export const rows = (v: unknown): Doc[] => (Array.isArray(v) ? v.map(obj) : []);
export const text = (v: unknown, max = 1000): string =>
  typeof v === "string"
    ? v.trim().slice(0, max)
    : v == null
      ? ""
      : String(v).slice(0, max);
export const integer = (v: unknown, min = 0, max = 1000000000): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new LiveError("숫자 범위를 확인해 주세요.", 422);
  return n;
};
export class LiveError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function required(v: unknown, label: string, max = 200) {
  const s = text(v, max);
  if (!s) throw new LiveError(`${label}을(를) 입력해 주세요.`, 422);
  return s;
}
export const mobileOf = (v: unknown) => {
  const s = text(v, 30).replace(/\D/gu, "");
  if (!/^0\d{8,10}$/u.test(s))
    throw new LiveError("전화번호를 확인해 주세요.", 422);
  return s;
};
export const day = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(now)
    .replaceAll("-", "");
export function cartOf(input: unknown) {
  const merged = new Map<number, number>();
  for (const item of rows(input)) {
    const id = integer(item.seqno ?? item.itemId ?? item.productId, 1);
    merged.set(
      id,
      (merged.get(id) ?? 0) + integer(item.qty ?? item.quantity, 1, 9999),
    );
  }
  if (!merged.size || merged.size > 100)
    throw new LiveError("상품을 1~100종 선택해 주세요.", 422);
  return [...merged].map(([id, qty]) => ({ id, qty: integer(qty, 1, 9999) }));
}
export function itemOf(input: unknown): Doc & {
  iname: string;
  unit: string;
  cost: number;
  stock: number;
  use_yn: string;
} {
  const d = obj(input);
  return {
    ...d,
    iname: required(d.iname ?? d.name, "품목명", 120),
    unit: text(d.unit, 30) || "개",
    cost: integer(d.cost ?? d.price ?? 0),
    stock: integer(d.stock ?? d.qty ?? 999999, 0, 999999),
    use_yn: d.use_yn === "N" || d.disp_gbn === "N" ? "N" : "Y",
  };
}
export function publicNotice(setting: Doc) {
  const s = text(setting.notice ?? setting.contents ?? setting.guide, 20000);
  return s.replace(/<[^>]*>/gu, "");
}
export function nearestRoute(stops: Doc[], origin?: Doc) {
  const remaining = [...stops];
  const result: Doc[] = [];
  let current = origin;
  while (remaining.length) {
    let index = 0;
    if (
      current &&
      Number.isFinite(Number(current.lat)) &&
      Number.isFinite(Number(current.lon))
    ) {
      let best = Infinity;
      remaining.forEach((s, i) => {
        const distance = Math.hypot(
          Number(s.lat) - Number(current!.lat),
          Number(s.lon) - Number(current!.lon),
        );
        if (Number.isFinite(distance) && distance < best) {
          best = distance;
          index = i;
        }
      });
    }
    current = remaining.splice(index, 1)[0];
    result.push({ ...current, seq: result.length + 1 });
  }
  return result;
}
export function assertSameCustomer(orders: Doc[]) {
  if (orders.length < 2 || orders.length > 100)
    throw new LiveError("병합할 주문을 2~100건 선택해 주세요.", 422);
  const signature = (o: Doc) =>
    JSON.stringify([
      o.customer_id,
      obj(o.data).addr,
      obj(o.data).addr2,
      obj(o.data).delivery_gbn,
    ]);
  if (
    orders.some(
      (o) =>
        o.status === "40" ||
        o.merged_into ||
        signature(o) !== signature(orders[0]),
    )
  )
    throw new LiveError(
      "동일 고객·배송지의 취소되지 않은 주문만 병합할 수 있습니다.",
      409,
    );
}
