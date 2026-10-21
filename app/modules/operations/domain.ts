export type DeliveryRunDraft = {
  serviceDate: string;
  title: string;
  orderIds: string[];
};

export type DeliveryRunStatus = "planned" | "running" | "completed" | "cancelled";
export type DeliveryStopStatus = "waiting" | "out_for_delivery" | "delivered" | "failed" | "held";

export const deliveryRunStatuses = new Set<DeliveryRunStatus>(["planned", "running", "completed", "cancelled"]);
export const deliveryStopStatuses = new Set<DeliveryStopStatus>(["waiting", "out_for_delivery", "delivered", "failed", "held"]);

const runTransitions: Record<DeliveryRunStatus, ReadonlySet<DeliveryRunStatus>> = {
  planned: new Set(["running", "cancelled"]),
  running: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};

export function canTransitionDeliveryRun(from: DeliveryRunStatus, to: DeliveryRunStatus) {
  return from === to || runTransitions[from].has(to);
}

export function validateDeliveryRunDraft(value: unknown): DeliveryRunDraft {
  if (!value || typeof value !== "object") throw new Error("배송 작업 내용을 확인해 주세요.");
  const source = value as Record<string, unknown>;
  const serviceDate = typeof source.serviceDate === "string" ? source.serviceDate.trim() : "";
  const title = typeof source.title === "string" ? source.title.trim() : "";
  const orderIds = Array.isArray(source.orderIds)
    ? [...new Set(source.orderIds.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{8,80}$/u.test(id)))]
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(serviceDate)) throw new Error("배송 날짜를 확인해 주세요.");
  if (!title || title.length > 80) throw new Error("배송 작업 이름은 1~80자로 입력해 주세요.");
  if (!orderIds.length || orderIds.length > 100) throw new Error("배송 주문은 1~100건을 선택해 주세요.");
  return { serviceDate, title, orderIds };
}
