export type OrderPayload = {
  formSlug?: unknown;
  customerName?: unknown;
  phone?: unknown;
  deliveryMethod?: unknown;
  postalCode?: unknown;
  address?: unknown;
  addressDetail?: unknown;
  requestNote?: unknown;
  paymentMethod?: unknown;
  agreed?: unknown;
  website?: unknown;
  idempotencyKey?: unknown;
  items?: unknown;
};

export type NormalizedOrderItem = { productId: string; quantity: number };

export type NormalizedOrder = {
  formSlug: string;
  customerName: string;
  phone: string;
  deliveryMethod: "delivery" | "pickup";
  postalCode: string;
  address: string;
  addressDetail: string;
  requestNote: string;
  paymentMethod: "bank" | "pickup";
  agreed: true;
  idempotencyKey: string;
  items: NormalizedOrderItem[];
};

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

export type FormCatalog = {
  id: string;
  minOrderAmount: number;
  shippingFee: number;
  freeShippingAt: number;
  products: Map<string, CatalogProduct>;
};

export type PricedOrder = {
  items: Array<NormalizedOrderItem & { product: CatalogProduct; lineTotal: number }>;
  subtotal: number;
  shippingFee: number;
  total: number;
};

export class OrderInputError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status = 400, code = "invalid_order") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function normalizeOrderPayload(payload: OrderPayload): NormalizedOrder {
  const customerName = cleanText(payload.customerName, 50);
  const phone = cleanText(payload.phone, 20).replace(/[^0-9]/g, "");
  const formSlug = cleanText(payload.formSlug, 80);
  const idempotencyKey = cleanText(payload.idempotencyKey, 80);
  const deliveryMethod = cleanText(payload.deliveryMethod, 20);
  const paymentMethod = cleanText(payload.paymentMethod, 20);
  const address = cleanText(payload.address, 160);

  if (!customerName || !/^01[0-9]{8,9}$/.test(phone) || payload.agreed !== true) {
    throw new OrderInputError("이름, 휴대폰 번호, 개인정보 동의를 확인해 주세요.");
  }
  if (deliveryMethod !== "delivery" && deliveryMethod !== "pickup") {
    throw new OrderInputError("배송 방법을 확인해 주세요.");
  }
  if (paymentMethod !== "bank" && paymentMethod !== "pickup") {
    throw new OrderInputError("결제 방법을 확인해 주세요.");
  }
  if ((deliveryMethod === "delivery" && paymentMethod !== "bank") || (deliveryMethod === "pickup" && paymentMethod !== "pickup")) {
    throw new OrderInputError("배송 방법에 맞는 결제 방법을 선택해 주세요.");
  }
  if (deliveryMethod === "delivery" && !address) {
    throw new OrderInputError("배송 주소를 입력해 주세요.");
  }
  if (!formSlug) throw new OrderInputError("주문서를 확인해 주세요.");
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
    throw new OrderInputError("주문 요청 식별값을 확인해 주세요.");
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 30) {
    throw new OrderInputError("주문할 상품과 수량을 확인해 주세요.");
  }

  const quantities = new Map<string, number>();
  for (const value of payload.items) {
    if (!value || typeof value !== "object") throw new OrderInputError("상품 수량을 확인해 주세요.");
    const item = value as { productId?: unknown; quantity?: unknown };
    const productId = cleanText(item.productId, 80);
    const quantity = Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new OrderInputError("상품 수량은 1개부터 50개까지 입력할 수 있습니다.");
    }
    const aggregated = (quantities.get(productId) ?? 0) + quantity;
    if (aggregated > 50) throw new OrderInputError("한 상품은 최대 50개까지 주문할 수 있습니다.");
    quantities.set(productId, aggregated);
  }

  return {
    formSlug,
    customerName,
    phone,
    deliveryMethod,
    postalCode: cleanText(payload.postalCode, 12),
    address,
    addressDetail: cleanText(payload.addressDetail, 120),
    requestNote: cleanText(payload.requestNote, 300),
    paymentMethod,
    agreed: true,
    idempotencyKey,
    items: Array.from(quantities, ([productId, quantity]) => ({ productId, quantity })),
  };
}

export function canonicalOrderRequest(order: NormalizedOrder): string {
  return JSON.stringify({
    ...order,
    items: [...order.items].sort((a, b) => a.productId.localeCompare(b.productId)),
  });
}

export function priceOrder(order: NormalizedOrder, catalog: FormCatalog): PricedOrder {
  if (catalog.products.size !== order.items.length) {
    throw new OrderInputError("판매가 종료된 상품이 포함되어 있습니다.", 409, "product_unavailable");
  }
  let subtotal = 0;
  const items = order.items.map((item) => {
    const product = catalog.products.get(item.productId);
    if (!product) throw new OrderInputError("판매가 종료된 상품이 포함되어 있습니다.", 409, "product_unavailable");
    if (product.stock < item.quantity) {
      throw new OrderInputError(`${product.name}의 남은 수량을 확인해 주세요.`, 409, "insufficient_stock");
    }
    const lineTotal = product.price * item.quantity;
    subtotal += lineTotal;
    return { ...item, product, lineTotal };
  });
  if (subtotal < catalog.minOrderAmount) {
    throw new OrderInputError(`최소 주문금액은 ${catalog.minOrderAmount.toLocaleString("ko-KR")}원입니다.`);
  }
  const shippingFee = order.deliveryMethod === "pickup" || (catalog.freeShippingAt > 0 && subtotal >= catalog.freeShippingAt)
    ? 0
    : catalog.shippingFee;
  return { items, subtotal, shippingFee, total: subtotal + shippingFee };
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
