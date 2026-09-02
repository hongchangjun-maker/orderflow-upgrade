export type OrderStatus = "new" | "confirmed" | "packing" | "shipping" | "done" | "cancelled";

export type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  stock: number;
  lowStockAt: number;
  icon: string;
  description: string;
  active: boolean;
  sortOrder: number;
};

export type PublicOrderForm = {
  id: string;
  slug: string;
  title: string;
  notice: string;
  minOrderAmount: number;
  shippingFee: number;
  freeShippingAt: number;
  shop: {
    name: string;
    tagline: string;
    phone: string;
    paymentGuide: string;
    orderCompleteMessage: string;
  };
  products: Product[];
};

export const STATUS_META: Record<OrderStatus, { label: string; tone: string }> = {
  new: { label: "새 주문", tone: "blue" },
  confirmed: { label: "확인", tone: "indigo" },
  packing: { label: "포장", tone: "amber" },
  shipping: { label: "배송", tone: "violet" },
  done: { label: "완료", tone: "green" },
  cancelled: { label: "취소", tone: "gray" },
};
