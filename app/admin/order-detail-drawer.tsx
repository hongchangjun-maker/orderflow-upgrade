"use client";

import { useEffect, useState } from "react";
import { STATUS_META, type OrderStatus } from "../lib/types";
import { adminApi } from "./client-api";

type Detail = {
  id: string; orderNo: string; customerName: string; customerPhone: string; deliveryMethod: string;
  postalCode: string; address: string; addressDetail: string; requestNote: string; paymentMethod: string;
  paymentStatus: string; status: OrderStatus; subtotal: number; shippingFee: number; total: number; createdAt: string;
  items: Array<{ productName: string; unitPrice: number; quantity: number; lineTotal: number }>;
};
const won = (value: number) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

export function OrderDetailDrawer({ orderId, onClose, notify }: { orderId: string; onClose: () => void; notify: (value: string) => void }) {
  const [order, setOrder] = useState<Detail | null>(null);
  useEffect(() => {
    let active = true;
    adminApi<{ order: Detail }>(`/api/admin/orders/${encodeURIComponent(orderId)}`).then((data) => active && setOrder(data.order)).catch((error) => notify(error.message));
    return () => { active = false; };
  }, [notify, orderId]);
  const print = () => {
    if (!order) return;
    const popup = window.open("", "_blank", "width=760,height=900");
    if (!popup) return notify("팝업 차단을 해제한 뒤 다시 시도해 주세요.");
    popup.opener = null;
    const rows = order.items.map((item) => `<tr><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td>${escapeHtml(won(item.unitPrice))}</td><td>${escapeHtml(won(item.lineTotal))}</td></tr>`).join("");
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(order.orderNo)}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:32px}h1{font-size:25px}header{border-bottom:2px solid #111;margin-bottom:22px}dl{display:grid;grid-template-columns:120px 1fr;margin:0}dt,dd{padding:8px;border-bottom:1px solid #ddd;margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border-bottom:1px solid #ccc;text-align:right}th:first-child,td:first-child{text-align:left}.total{font-size:20px;font-weight:800;text-align:right;margin-top:20px}@media print{body{padding:0}}</style></head><body><header><small>ORDERFLOW ORDER SHEET</small><h1>주문서 ${escapeHtml(order.orderNo)}</h1></header><dl><dt>주문 일시</dt><dd>${escapeHtml(new Date(order.createdAt).toLocaleString("ko-KR"))}</dd><dt>고객</dt><dd>${escapeHtml(order.customerName)} · ${escapeHtml(order.customerPhone)}</dd><dt>배송지</dt><dd>${escapeHtml(`${order.address} ${order.addressDetail}`.trim() || "매장 픽업")}</dd><dt>요청사항</dt><dd>${escapeHtml(order.requestNote || "없음")}</dd><dt>상태</dt><dd>${escapeHtml(STATUS_META[order.status].label)} · ${order.paymentStatus === "paid" ? "입금 확인" : "미입금"}</dd></dl><table><thead><tr><th>상품</th><th>수량</th><th>단가</th><th>금액</th></tr></thead><tbody>${rows}</tbody></table><p class="total">합계 ${escapeHtml(won(order.total))}</p><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  };
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="order-detail-drawer" role="dialog" aria-modal="true" aria-label="주문 상세">
    <div className="panel-head"><div><p className="eyebrow">ORDER DETAIL</p><h2>{order?.orderNo ?? "주문 불러오는 중"}</h2></div><button className="round-button" onClick={onClose} aria-label="닫기">×</button></div>
    {!order ? <div className="loading-state"><i /><p>주문 상세를 불러오고 있습니다.</p></div> : <><div className="detail-status"><span className={`status-select ${STATUS_META[order.status].tone}`}>{STATUS_META[order.status].label}</span><b>{order.paymentStatus === "paid" ? "입금 확인" : "미입금"}</b></div><dl className="detail-list"><div><dt>주문 일시</dt><dd>{new Date(order.createdAt).toLocaleString("ko-KR")}</dd></div><div><dt>고객</dt><dd>{order.customerName}<small>{order.customerPhone}</small></dd></div><div><dt>수령 방법</dt><dd>{order.deliveryMethod === "delivery" ? "배송" : "매장 픽업"}</dd></div><div><dt>배송지</dt><dd>{`${order.address} ${order.addressDetail}`.trim() || "-"}</dd></div><div><dt>요청사항</dt><dd>{order.requestNote || "없음"}</dd></div></dl><div className="detail-items">{order.items.map((item) => <div key={`${item.productName}-${item.unitPrice}`}><p><b>{item.productName}</b><small>{won(item.unitPrice)} × {item.quantity}</small></p><strong>{won(item.lineTotal)}</strong></div>)}</div><div className="detail-totals"><span>상품 {won(order.subtotal)}</span><span>배송비 {won(order.shippingFee)}</span><strong>합계 {won(order.total)}</strong></div><button className="button button-primary button-full" onClick={print}>인쇄용 주문서 열기</button></>}
  </aside></div>;
}
