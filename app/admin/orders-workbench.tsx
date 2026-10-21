"use client";

import { useMemo, useState } from "react";
import { STATUS_META, type OrderStatus } from "../lib/types";
import { OrderDetailDrawer } from "./order-detail-drawer";

export type AdminOrder = {
  id: string; orderNo: string; customerName: string; customerPhone: string; deliveryMethod: string;
  paymentMethod: string; paymentStatus: string; status: OrderStatus; total: number; requestNote: string;
  createdAt: string; items: string;
};

type Mode = "simple" | "work";
type DetailPreferences = { phone: boolean; request: boolean };

const won = (value: number) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const shortTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const kstDate = (date = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);

export function OrdersWorkbench({
  orders, filter, query, dateFrom, dateTo, nextCursor, onFilter, onQuery, onDateFrom, onDateTo,
  onLoadMore, onUpdate, busy, notify,
}: {
  orders: AdminOrder[]; filter: string; query: string; dateFrom: string; dateTo: string; nextCursor: string | null;
  onFilter: (value: string) => void; onQuery: (value: string) => void; onDateFrom: (value: string) => void; onDateTo: (value: string) => void;
  onLoadMore: () => void; onUpdate: (ids: string[], status?: OrderStatus, paymentStatus?: "paid" | "unpaid") => Promise<void>;
  busy: boolean; notify: (value: string) => void;
}) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState(query);
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "work";
    const saved = localStorage.getItem("orderflow:orders-mode");
    return saved === "simple" || saved === "work" ? saved : "work";
  });
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>("confirmed");
  const [preferences, setPreferences] = useState<DetailPreferences>(() => {
    if (typeof window === "undefined") return { phone: true, request: true };
    try { return { phone: true, request: true, ...JSON.parse(localStorage.getItem("orderflow:orders-details") ?? "{}") }; }
    catch { return { phone: true, request: true }; }
  });
  const [showPreferences, setShowPreferences] = useState(false);

  const visibleOrderIds = useMemo(() => new Set(orders.map((order) => order.id)), [orders]);
  const selectedSet = useMemo(() => new Set(selected.filter((id) => visibleOrderIds.has(id))), [selected, visibleOrderIds]);
  const allSelected = orders.length > 0 && orders.every((order) => selectedSet.has(order.id));
  const exportParams = new URLSearchParams({ status: filter, q: query });
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);

  const setViewMode = (value: Mode) => { setMode(value); try { localStorage.setItem("orderflow:orders-mode", value); } catch { /* 현재 세션에서만 유지합니다. */ } };
  const updatePreferences = (key: keyof DetailPreferences, value: boolean) => {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try { localStorage.setItem("orderflow:orders-details", JSON.stringify(next)); } catch { /* 현재 세션에서만 유지합니다. */ }
  };
  const applyPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    onDateFrom(kstDate(start)); onDateTo(kstDate(end));
  };
  const applySearch = () => onQuery(queryDraft.trim());
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected(allSelected ? selected.filter((id) => !orders.some((order) => order.id === id)) : [...new Set([...selected, ...orders.map((order) => order.id)])]);
  const runBulk = async (status?: OrderStatus, paymentStatus?: "paid" | "unpaid") => {
    if (!selected.length) return notify("처리할 주문을 먼저 선택해 주세요.");
    await onUpdate(selected, status, paymentStatus);
    setSelected([]);
  };

  return <section className={`panel data-panel order-workbench mode-${mode}`}>
    <header className="legacy-workbench-head">
      <div><p className="eyebrow">ORDER DESK</p><h2>주문 통합 관리</h2><p>기존 업무형 목록의 빠른 처리 방식과 새 ORDERFLOW의 안전한 동시 주문 엔진을 함께 사용합니다.</p></div>
      <div className="view-mode-toggle" role="group" aria-label="주문 화면 모드"><button className={mode === "simple" ? "active" : ""} onClick={() => setViewMode("simple")}>간편 모드</button><button className={mode === "work" ? "active" : ""} onClick={() => setViewMode("work")}>업무 모드</button></div>
    </header>

    <div className="legacy-filter-strip">
      <div className="date-presets"><b>조회 기간</b><button onClick={() => applyPreset(1)}>오늘</button><button onClick={() => applyPreset(7)}>7일</button><button onClick={() => applyPreset(30)}>30일</button></div>
      <label><span>시작일</span><input type="date" value={dateFrom} onChange={(event) => onDateFrom(event.target.value)} /></label>
      <label><span>종료일</span><input type="date" value={dateTo} onChange={(event) => onDateTo(event.target.value)} /></label>
      <div className="search-box"><input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && applySearch()} placeholder="주문번호, 고객명, 휴대폰" aria-label="주문 검색" /><button onClick={applySearch}>검색</button></div>
      <button className="button button-ghost preference-button" onClick={() => setShowPreferences((value) => !value)}>표시 설정</button>
      <a className="button button-ghost" href={`/api/admin/orders/export?${exportParams.toString()}`}>엑셀용 CSV</a>
    </div>
    {showPreferences && <div className="order-display-preferences"><b>목록에 표시</b><label><input type="checkbox" checked={preferences.phone} onChange={(event) => updatePreferences("phone", event.target.checked)} /> 휴대폰</label><label><input type="checkbox" checked={preferences.request} onChange={(event) => updatePreferences("request", event.target.checked)} /> 요청사항</label><button onClick={() => setShowPreferences(false)}>완료</button></div>}

    <div className="data-toolbar legacy-status-toolbar">
      <div className="filter-tabs"><span className="live-order-chip">● 15초 자동 갱신</span>{["all", ...Object.keys(STATUS_META)].map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => onFilter(status)}>{status === "all" ? "전체" : STATUS_META[status as OrderStatus].label}</button>)}</div>
      <span className="result-count">현재 {orders.length}건</span>
    </div>

    {selected.length > 0 && <div className="bulk-action-bar" role="region" aria-label="선택 주문 일괄 처리"><strong>{selected.length}건 선택</strong><select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as OrderStatus)} aria-label="일괄 주문 상태">{(Object.keys(STATUS_META) as OrderStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select><button onClick={() => runBulk(bulkStatus)} disabled={busy}>상태 일괄 변경</button><button onClick={() => runBulk(undefined, "paid")} disabled={busy}>입금 확인</button><button onClick={() => runBulk(undefined, "unpaid")} disabled={busy}>미입금 처리</button><button className="clear-selection" onClick={() => setSelected([])}>선택 해제</button></div>}

    <div className="order-list legacy-order-list">
      <div className="order-row order-head"><label><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="현재 주문 전체 선택" /></label><span>주문</span><span>고객</span><span>주문 품목</span><span>입금</span><span>합계</span><span>처리 상태</span></div>
      {orders.map((order) => <div className={`order-row ${selectedSet.has(order.id) ? "selected" : ""}`} key={order.id}>
        <label className="order-select"><input type="checkbox" checked={selectedSet.has(order.id)} onChange={() => toggle(order.id)} aria-label={`${order.orderNo} 선택`} /></label>
        <div><button className="order-link" onClick={() => setSelectedOrderId(order.id)}>{order.orderNo}</button><small>{shortTime(order.createdAt)} · {order.deliveryMethod === "delivery" ? "배송" : "픽업"}</small></div>
        <div><b>{order.customerName}</b>{preferences.phone && <small>{order.customerPhone.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")}</small>}</div>
        <div><b className="clamp-one">{order.items || "상품 정보 없음"}</b>{preferences.request && <small>{order.requestNote || "요청사항 없음"}</small>}</div>
        <button className={`payment-toggle ${order.paymentStatus === "paid" ? "paid" : ""}`} onClick={() => onUpdate([order.id], undefined, order.paymentStatus === "paid" ? "unpaid" : "paid")} disabled={busy}>{order.paymentStatus === "paid" ? "입금 확인" : "미입금"}</button>
        <strong>{won(order.total)}</strong>
        <select value={order.status} onChange={(event) => onUpdate([order.id], event.target.value as OrderStatus)} disabled={busy} aria-label={`${order.orderNo} 상태`} className={`status-select ${STATUS_META[order.status].tone}`}>{(Object.keys(STATUS_META) as OrderStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select>
      </div>)}
      {!orders.length && <div className="empty-state"><span><img src="/visuals/icons/orders.webp" alt="" /></span><p>조회 조건에 맞는 주문이 없습니다.</p></div>}
    </div>
    {nextCursor && <div className="load-more-row"><button className="button button-ghost" onClick={onLoadMore} disabled={busy}>이전 주문 60건 더 보기</button></div>}
    {selectedOrderId && <OrderDetailDrawer orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} notify={notify} />}
  </section>;
}
