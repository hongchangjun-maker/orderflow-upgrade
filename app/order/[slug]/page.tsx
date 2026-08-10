import type { Metadata } from "next";
import { OrderFormApp } from "./order-form";

export const metadata: Metadata = { title: "고객 주문서", description: "수량을 고르고 배송 정보를 입력하면 주문이 완료됩니다." };

export default async function OrderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <OrderFormApp slug={slug} />;
}
