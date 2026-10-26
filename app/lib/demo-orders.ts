import type { AdminOrder, OrderStatus } from "./types";

const names = ["김하늘", "이정원", "박민서", "최윤아", "정도현", "한수진", "오지훈", "서예린", "임재현", "유나경"];
const products = ["햇살 복숭아 2팩", "목초 유정란 1판", "춘천식 닭갈비 3팩", "머스크 멜론 1통", "여수 파김치 2kg", "삼일 숙성 카레 5팩", "고기 빈대떡 2세트", "가평 잣막국수 4인분"];
const requests = ["문 앞에 놓아주세요.", "도착 전에 연락 부탁드립니다.", "신선한 상품으로 부탁드려요.", "공동현관 비밀번호는 경비실에 문의해 주세요.", "", "매장 도착 후 전화드릴게요."];
const statuses: OrderStatus[] = ["new", "new", "confirmed", "packing", "shipping", "done", "done", "cancelled"];

const pad = (value: number, length: number) => String(value).padStart(length, "0");
const localDate = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(value));

export function createDemoOrders(count: number, offset = 0, now = Date.now()): AdminOrder[] {
  return Array.from({ length: Math.max(0, Math.min(2_000, count)) }, (_, index) => {
    const sequence = offset + index + 1;
    const productIndex = sequence % products.length;
    const createdAt = new Date(now - index * 8 * 60_000).toISOString();
    const quantity = sequence % 4 + 1;
    return {
      id: `demo-order-${pad(sequence, 6)}`,
      orderNo: `SIM-${pad(sequence, 6)}`,
      customerName: names[sequence % names.length],
      customerPhone: `010${pad(1200 + sequence % 8000, 4)}${pad(3000 + sequence % 6000, 4)}`,
      deliveryMethod: sequence % 5 === 0 ? "pickup" : "delivery",
      paymentMethod: sequence % 5 === 0 ? "pickup" : "bank",
      paymentStatus: sequence % 3 === 0 ? "paid" : "unpaid",
      status: statuses[sequence % statuses.length],
      total: 8_900 + productIndex * 2_300 + quantity * 4_700,
      requestNote: requests[sequence % requests.length],
      createdAt,
      items: `${products[productIndex]} 외 ${sequence % 3}종`,
    };
  });
}

export function filterDemoOrders(orders: AdminOrder[], filter: string, query: string, dateFrom: string, dateTo: string) {
  const normalized = query.trim().toLowerCase();
  return orders.filter((order) => {
    if (filter !== "all" && order.status !== filter) return false;
    if (normalized && !`${order.orderNo} ${order.customerName} ${order.customerPhone}`.toLowerCase().includes(normalized)) return false;
    const date = localDate(order.createdAt);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  });
}

export function summarizeDemoOrders(orders: AdminOrder[]) {
  return {
    total: orders.length,
    open: orders.filter((order) => !["done", "cancelled"].includes(order.status)).length,
    unpaid: orders.filter((order) => order.paymentStatus !== "paid").length,
    sales: orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + order.total, 0),
  };
}
