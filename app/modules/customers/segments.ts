export type CustomerSegment = "vip" | "regular" | "new" | "inactive" | "occasional";

export const CUSTOMER_SEGMENTS: Record<CustomerSegment, { label: string; description: string }> = {
  vip: { label: "VIP", description: "10회 이상 또는 누적 50만원 이상" },
  regular: { label: "단골", description: "최근 90일 안에 3회 이상 주문" },
  new: { label: "신규", description: "최근 30일 안에 첫 주문" },
  inactive: { label: "휴면", description: "마지막 주문 후 90일 이상" },
  occasional: { label: "일반", description: "그 밖의 주문 고객" },
};

export type CustomerSegmentInput = {
  orderCount: number;
  totalSpent: number;
  lastOrderedAt: string | null;
};

const dayMs = 86_400_000;

export function classifyCustomer(input: CustomerSegmentInput, now = new Date()): CustomerSegment {
  if (input.orderCount >= 10 || input.totalSpent >= 500_000) return "vip";
  const last = input.lastOrderedAt ? new Date(input.lastOrderedAt).getTime() : Number.NaN;
  const daysSince = Number.isFinite(last) ? Math.max(0, (now.getTime() - last) / dayMs) : Number.POSITIVE_INFINITY;
  if (daysSince >= 90) return "inactive";
  if (input.orderCount >= 3) return "regular";
  if (input.orderCount <= 1 && daysSince <= 30) return "new";
  return "occasional";
}

