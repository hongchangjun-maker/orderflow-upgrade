"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createDemoOrders, filterDemoOrders, summarizeDemoOrders } from "../lib/demo-orders";
import { STATUS_META, type AdminOrder, type OrderStatus } from "../lib/types";
import { OrdersWorkbench } from "./orders-workbench";

const STORAGE_KEY = "orderflow:demo-orders:v1";
const HYDRATION_SEED_TIME = Date.parse("2026-10-26T03:00:00.000Z");
const won = (value: number) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function DemoAdminApp() {
  const [orders, setOrders] = useState<AdminOrder[]>(() => createDemoOrders(84, 0, HYDRATION_SEED_TIME));
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(60);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
        if (Array.isArray(saved) && saved.length > 0 && saved.length <= 2_000) setOrders(saved as AdminOrder[]);
        else setOrders(createDemoOrders(84, 0, Date.now()));
      } catch { localStorage.removeItem(STORAGE_KEY); }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(orders)); } catch { /* 저장이 막혀도 현재 탭에서는 계속 테스트합니다. */ }
  }, [hydrated, orders]);
  const notify = (value: string) => { setMessage(value); window.setTimeout(() => setMessage(""), 2800); };
  const filtered = useMemo(() => filterDemoOrders(orders, filter, query, dateFrom, dateTo), [dateFrom, dateTo, filter, orders, query]);
  const visible = filtered.slice(0, limit);
  const summary = useMemo(() => summarizeDemoOrders(orders), [orders]);
  const nextOffset = orders.reduce((maximum, order) => Math.max(maximum, Number(order.id.split("-").at(-1)) || 0), 0);

  const addOrders = (count: number) => {
    const created = createDemoOrders(count, nextOffset, Date.now());
    setOrders((current) => [...created, ...current].slice(0, 2_000));
    notify(`가상 주문 ${count.toLocaleString("ko-KR")}건을 추가했습니다.`);
  };
  const replaceOrders = (count: number) => {
    setOrders(createDemoOrders(count));
    setFilter("all"); setQuery(""); setDateFrom(""); setDateTo(""); setLimit(60);
    notify(`${count.toLocaleString("ko-KR")}건 부하 시뮬레이션을 준비했습니다.`);
  };
  const updateOrders = async (ids: string[], status?: OrderStatus, paymentStatus?: "paid" | "unpaid") => {
    const targets = new Set(ids.slice(0, 100));
    setOrders((current) => current.map((order) => targets.has(order.id) ? { ...order, status: status ?? order.status, paymentStatus: paymentStatus ?? order.paymentStatus } : order));
    notify(`${targets.size}건의 가상 주문을 변경했습니다.`);
  };
  const exportDemoCsv = () => {
    const rows = [["주문번호", "주문일시", "고객", "휴대폰", "상품", "금액", "입금", "상태"], ...filtered.map((order) => [order.orderNo, order.createdAt, order.customerName, order.customerPhone, order.items, order.total, order.paymentStatus === "paid" ? "입금 확인" : "미입금", STATUS_META[order.status].label])];
    const blob = new Blob([`\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "orderflow-demo-orders.csv";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify(`현재 조건의 가상 주문 ${filtered.length.toLocaleString("ko-KR")}건을 CSV로 만들었습니다.`);
  };

  return <div className="admin-shell demo-admin-shell">
    <aside className="admin-sidebar">
      <Link href="/" className="brand-lockup admin-brand"><img src="/visuals/orderflow-mark.webp" alt="" /><span>ORDERFLOW</span></Link>
      <div className="workspace-card demo-workspace"><span>SIMULATION</span><b>가상 운영 센터</b><small>실제 데이터와 분리됨</small></div>
      <nav className="admin-menu" aria-label="시뮬레이션 메뉴"><button className="active"><img src="/visuals/icons/orders.webp" alt="" />주문 시뮬레이션</button><Link href="/order/fresh-market"><img src="/visuals/icons/forms.webp" alt="" />고객 주문서</Link></nav>
      <div className="integration-note"><span>안전한 체험</span><b>로그인 없이 실행</b><small>변경 내용은 이 브라우저에만 저장됩니다.</small></div>
      <div className="admin-user"><span>D</span><div><b>데모 사용자</b><small>가입·로그인 없음</small></div></div>
    </aside>

    <main className="admin-main">
      <header className="admin-topbar"><div><p>가입이나 로그인 없이 바로 테스트</p><h1>주문 운영 시뮬레이션</h1></div><div className="topbar-actions"><Link href="/order/fresh-market" target="_blank" className="button button-ghost">고객 주문서 열기</Link><Link href="/" className="button button-soft">홈으로</Link></div></header>
      <div className="admin-content demo-admin-content">
        <section className="demo-safety-banner"><div><span>DEMO MODE</span><h2>버튼을 눌러 마음껏 시험해 보세요.</h2><p>여기의 이름·전화번호·주문은 모두 가상 데이터이며 실제 D1 주문과 관리자 계정에는 접근하지 않습니다.</p></div><b>운영 데이터 0건 사용</b></section>
        <section className="demo-control-panel panel">
          <div className="demo-summary-grid"><article><span>가상 주문</span><strong>{summary.total.toLocaleString("ko-KR")}</strong></article><article><span>처리 중</span><strong>{summary.open.toLocaleString("ko-KR")}</strong></article><article><span>미입금</span><strong>{summary.unpaid.toLocaleString("ko-KR")}</strong></article><article><span>가상 매출</span><strong>{won(summary.sales)}</strong></article></div>
          <div className="demo-load-actions"><button className="button button-primary" onClick={() => addOrders(1)}>새 주문 1건 도착</button><button className="button button-ghost" onClick={() => addOrders(100)}>가상 주문 100건 추가</button><button className="button button-ghost" onClick={() => replaceOrders(1_000)}>1,000건 부하 구성</button><button className="button button-soft" onClick={() => replaceOrders(84)}>처음 상태로 초기화</button></div>
        </section>
        <OrdersWorkbench key={`${filter}|${query}|${dateFrom}|${dateTo}`} orders={visible} filter={filter} query={query} dateFrom={dateFrom} dateTo={dateTo} nextCursor={filtered.length > limit ? "demo-more" : null} onFilter={(value) => { setFilter(value); setLimit(60); }} onQuery={(value) => { setQuery(value); setLimit(60); }} onDateFrom={(value) => { setDateFrom(value); setLimit(60); }} onDateTo={(value) => { setDateTo(value); setLimit(60); }} onLoadMore={() => setLimit((current) => Math.min(current + 60, filtered.length))} onUpdate={updateOrders} onOpenOrder={setSelectedOrder} onExport={exportDemoCsv} description="가상 주문으로 검색·기간 조회·일괄 처리를 연습합니다. 실제 서버에는 저장하지 않습니다." autoRefreshLabel="가상 데이터 즉시 반영" busy={false} notify={notify} />
      </div>
      {message && <div className="toast" role="status">{message}</div>}
      {selectedOrder && <DemoOrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </main>
  </div>;
}

function DemoOrderDrawer({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="order-detail-drawer" role="dialog" aria-modal="true" aria-label="가상 주문 상세">
    <div className="panel-head"><div><p className="eyebrow">DEMO ORDER DETAIL</p><h2>{order.orderNo}</h2></div><button className="round-button" onClick={onClose} aria-label="닫기">×</button></div>
    <div className="demo-detail-notice">이 주문은 시뮬레이션용 가상 데이터입니다.</div>
    <div className="detail-status"><span className={`status-select ${STATUS_META[order.status].tone}`}>{STATUS_META[order.status].label}</span><b>{order.paymentStatus === "paid" ? "입금 확인" : "미입금"}</b></div>
    <dl className="detail-list"><div><dt>주문 일시</dt><dd>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(order.createdAt))}</dd></div><div><dt>고객</dt><dd>{order.customerName}<small>{order.customerPhone}</small></dd></div><div><dt>수령 방법</dt><dd>{order.deliveryMethod === "delivery" ? "배송" : "매장 픽업"}</dd></div><div><dt>주문 품목</dt><dd>{order.items}</dd></div><div><dt>요청사항</dt><dd>{order.requestNote || "없음"}</dd></div><div><dt>합계</dt><dd>{won(order.total)}</dd></div></dl>
    <button className="button button-primary button-full" onClick={onClose}>확인</button>
  </aside></div>;
}
