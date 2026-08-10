"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STATUS_META, type OrderStatus, type Product } from "../lib/types";

type Tab = "dashboard" | "orders" | "products" | "forms" | "customers" | "analytics" | "settings";
type Dashboard = {
  metrics: { ordersToday: number; salesToday: number; openOrders: number; lowStock: number };
  statuses: Array<{ status: OrderStatus; count: number }>;
  topProducts: Array<{ name: string; quantity: number; sales: number }>;
  activities: Array<{ action: string; summary: string; actor: string; createdAt: string }>;
};
type Order = {
  id: string; orderNo: string; customerName: string; customerPhone: string; deliveryMethod: string;
  paymentMethod: string; paymentStatus: string; status: OrderStatus; total: number; requestNote: string;
  createdAt: string; items: string;
};
type Customer = { id: string; name: string; phone: string; address: string; orderCount: number; totalSpent: number; points: number; lastOrderedAt: string | null };
type FormConfig = { id: string; slug: string; title: string; notice: string; minOrderAmount: number; shippingFee: number; freeShippingAt: number; active: boolean; productIds: string[] };
type ShopSettings = { name: string; tagline: string; phone: string; paymentGuide: string; orderCompleteMessage: string };

const menu: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "dashboard", label: "오늘 운영", icon: "dashboard" },
  { id: "orders", label: "주문 관리", icon: "orders" },
  { id: "products", label: "상품·재고", icon: "products" },
  { id: "forms", label: "주문서 만들기", icon: "forms" },
  { id: "customers", label: "고객", icon: "customers" },
  { id: "analytics", label: "매출 분석", icon: "analytics" },
  { id: "settings", label: "설정", icon: "settings" },
];

const won = (value: number) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const shortTime = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "-";
const productImage = (id: string) => `/visuals/products/${id.replace("prod-", "")}.webp`;

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, cache: "no-store" });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}

export function AdminApp({ user }: { user: { name: string; email: string } }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<FormConfig | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");

  const notify = (value: string) => { setMessage(value); window.setTimeout(() => setMessage(""), 2500); };
  const loadDashboard = useCallback(async () => setDashboard((await api<{ metrics: Dashboard["metrics"]; statuses: Dashboard["statuses"]; topProducts: Dashboard["topProducts"]; activities: Dashboard["activities"] }>("/api/admin/dashboard"))), []);
  const loadOrders = useCallback(async () => setOrders((await api<{ orders: Order[] }>(`/api/admin/orders?status=${orderFilter}&q=${encodeURIComponent(orderQuery)}`)).orders), [orderFilter, orderQuery]);
  const loadProducts = useCallback(async () => setProducts((await api<{ products: Product[] }>("/api/admin/products")).products.map((product) => ({ ...product, active: Boolean(product.active) }))), []);
  const loadCustomers = useCallback(async () => setCustomers((await api<{ customers: Customer[] }>("/api/admin/customers")).customers), []);
  const loadForm = useCallback(async () => setForm((await api<{ form: FormConfig }>("/api/admin/forms")).form), []);
  const loadSettings = useCallback(async () => setSettings((await api<{ settings: ShopSettings }>("/api/admin/settings")).settings), []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadDashboard().catch((error) => notify(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const task = tab === "orders" ? loadOrders() : tab === "products" ? loadProducts() : tab === "customers" ? loadCustomers() : tab === "forms" ? Promise.all([loadForm(), loadProducts()]) : tab === "settings" ? loadSettings() : tab === "analytics" ? loadDashboard() : Promise.resolve();
      task.catch((error) => notify(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, loadOrders, loadProducts, loadCustomers, loadForm, loadSettings, loadDashboard]);

  const statusCount = (status: OrderStatus) => dashboard?.statuses.find((item) => item.status === status)?.count ?? 0;
  const refreshAll = async () => { await Promise.all([loadDashboard(), loadOrders(), loadProducts()]); notify("최신 데이터로 새로고침했습니다."); };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/" className="brand-lockup admin-brand"><img src="/visuals/orderflow-mark.webp" alt="" /><span>ORDERFLOW</span></Link>
        <div className="workspace-card"><span>WORKSPACE</span><b>{settings?.name ?? "오더플로우 마켓"}</b><small>운영 중</small></div>
        <nav className="admin-menu" aria-label="관리자 메뉴">
          {menu.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><img src={`/visuals/icons/${item.icon}.webp`} alt="" />{item.label}</button>)}
        </nav>
        <div className="integration-note"><span>연동 센터</span><b>문자·결제·카카오</b><small>필요할 때 모듈을 연결하세요.</small></div>
        <div className="admin-user"><span>{user.name.slice(0, 1)}</span><div><b>{user.name}</b><small>{user.email}</small></div></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div><p>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</p><h1>{menu.find((item) => item.id === tab)?.label}</h1></div>
          <div className="topbar-actions"><Link href="/order/fresh-market" target="_blank" className="button button-ghost">고객 화면 열기</Link><button className="round-button icon-button" onClick={refreshAll} aria-label="새로고침"><img src="/visuals/icons/dashboard.webp" alt="" /></button><button className="button button-soft" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}>로그아웃</button></div>
        </header>

        <div className="admin-content">
          {tab === "dashboard" && <DashboardView dashboard={dashboard} statusCount={statusCount} onMove={setTab} />}
          {tab === "orders" && <OrdersView orders={orders} filter={orderFilter} query={orderQuery} onFilter={setOrderFilter} onQuery={setOrderQuery} onSearch={loadOrders} onUpdate={async (id, status, paymentStatus) => { setBusy(true); try { await api("/api/admin/orders", { method: "PATCH", body: JSON.stringify({ id, status, paymentStatus }) }); await Promise.all([loadOrders(), loadDashboard()]); notify("주문 상태를 변경했습니다."); } catch (error) { notify((error as Error).message); } finally { setBusy(false); } }} busy={busy} />}
          {tab === "products" && <ProductsView products={products} onSaved={async () => { await Promise.all([loadProducts(), loadDashboard()]); notify("상품 정보를 저장했습니다."); }} notify={notify} />}
          {tab === "forms" && <FormBuilder form={form} products={products} onChange={setForm} onSave={async () => { if (!form) return; setBusy(true); try { await api("/api/admin/forms", { method: "PUT", body: JSON.stringify(form) }); notify("주문서를 저장했습니다."); } catch (error) { notify((error as Error).message); } finally { setBusy(false); } }} busy={busy} />}
          {tab === "customers" && <CustomersView customers={customers} />}
          {tab === "analytics" && <AnalyticsView dashboard={dashboard} />}
          {tab === "settings" && <SettingsView settings={settings} onChange={setSettings} onSave={async () => { if (!settings) return; setBusy(true); try { await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }); notify("상점 설정을 저장했습니다."); } catch (error) { notify((error as Error).message); } finally { setBusy(false); } }} busy={busy} />}
        </div>
      </main>
      {message && <div className="toast" role="status">{message}</div>}
    </div>
  );
}

function DashboardView({ dashboard, statusCount, onMove }: { dashboard: Dashboard | null; statusCount: (status: OrderStatus) => number; onMove: (tab: Tab) => void }) {
  if (!dashboard) return <LoadingState />;
  const maxTop = Math.max(...dashboard.topProducts.map((item) => item.quantity), 1);
  return <div className="dashboard-grid">
    <section className="metric-grid">
      <Metric label="오늘 주문" value={dashboard.metrics.ordersToday.toLocaleString()} detail="실시간 접수" tone="blue" />
      <Metric label="오늘 매출" value={won(dashboard.metrics.salesToday)} detail="접수 총액" tone="green" />
      <Metric label="처리할 주문" value={dashboard.metrics.openOrders.toLocaleString()} detail="완료 전 주문" tone="violet" />
      <Metric label="재고 주의" value={dashboard.metrics.lowStock.toLocaleString()} detail="기준 이하 상품" tone="amber" />
    </section>
    <section className="panel panel-wide">
      <div className="panel-head"><div><p className="eyebrow">ORDER PIPELINE</p><h2>오늘의 주문 흐름</h2></div><button className="text-button" onClick={() => onMove("orders")}>주문 전체 보기 →</button></div>
      <div className="status-pipeline">
        {(Object.keys(STATUS_META) as OrderStatus[]).filter((status) => status !== "cancelled").map((status, index) => <div key={status} className="pipeline-step"><span>{String(index + 1).padStart(2, "0")}</span><strong>{statusCount(status)}</strong><small>{STATUS_META[status].label}</small><i /></div>)}
      </div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">BEST ITEMS</p><h2>많이 주문한 상품</h2></div></div>
      <div className="rank-list">{dashboard.topProducts.length ? dashboard.topProducts.map((item, index) => <div className="rank-row" key={item.name}><span>{index + 1}</span><div><b>{item.name}</b><i style={{ width: `${(item.quantity / maxTop) * 100}%` }} /></div><em>{item.quantity}개</em></div>) : <EmptyState text="아직 주문 데이터가 없습니다." />}</div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">RECENT LOG</p><h2>최근 작업</h2></div></div>
      <div className="activity-list">{dashboard.activities.length ? dashboard.activities.map((item, index) => <div key={`${item.createdAt}-${index}`}><span className="activity-dot" /><p><b>{item.summary}</b><small>{shortTime(item.createdAt)} · {item.actor === "customer" ? "고객" : "운영자"}</small></p></div>) : <EmptyState text="작업 기록이 없습니다." />}</div>
    </section>
  </div>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  const icon = tone === "green" ? "payment" : tone === "violet" ? "delivery" : tone === "amber" ? "inventory" : "orders";
  return <article className={`metric-card ${tone}`}><img className="metric-icon" src={`/visuals/icons/${icon}.webp`} alt="" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function OrdersView({ orders, filter, query, onFilter, onQuery, onSearch, onUpdate, busy }: { orders: Order[]; filter: string; query: string; onFilter: (v: string) => void; onQuery: (v: string) => void; onSearch: () => void; onUpdate: (id: string, status: OrderStatus, paymentStatus?: string) => void; busy: boolean }) {
  return <section className="panel data-panel">
    <div className="data-toolbar">
      <div className="filter-tabs">{["all", ...Object.keys(STATUS_META)].map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => onFilter(status)}>{status === "all" ? "전체" : STATUS_META[status as OrderStatus].label}</button>)}</div>
      <div className="search-box"><input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSearch()} placeholder="주문번호, 고객명, 휴대폰 검색" aria-label="주문 검색" /><button onClick={onSearch}>검색</button></div>
    </div>
    <div className="order-list">
      <div className="order-row order-head"><span>주문</span><span>고객</span><span>상품</span><span>결제</span><span>금액</span><span>상태</span></div>
      {orders.map((order) => <div className="order-row" key={order.id}>
        <div><b>{order.orderNo}</b><small>{shortTime(order.createdAt)} · {order.deliveryMethod === "delivery" ? "배송" : "픽업"}</small></div>
        <div><b>{order.customerName}</b><small>{order.customerPhone.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")}</small></div>
        <div><b className="clamp-one">{order.items || "상품 정보 없음"}</b><small>{order.requestNote || "요청사항 없음"}</small></div>
        <button className={`payment-toggle ${order.paymentStatus === "paid" ? "paid" : ""}`} onClick={() => onUpdate(order.id, order.status, order.paymentStatus === "paid" ? "unpaid" : "paid")} disabled={busy}>{order.paymentStatus === "paid" ? "입금 확인" : "미입금"}</button>
        <strong>{won(order.total)}</strong>
        <select value={order.status} onChange={(event) => onUpdate(order.id, event.target.value as OrderStatus)} disabled={busy} aria-label={`${order.orderNo} 상태`} className={`status-select ${STATUS_META[order.status].tone}`}>{(Object.keys(STATUS_META) as OrderStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select>
      </div>)}
      {!orders.length && <EmptyState text="조건에 맞는 주문이 없습니다." />}
    </div>
  </section>;
}

function ProductsView({ products, onSaved, notify }: { products: Product[]; onSaved: () => Promise<void>; notify: (value: string) => void }) {
  const blank: Product = { id: "", name: "", category: "과일", unit: "1팩", price: 0, stock: 0, lowStockAt: 5, icon: "BOX", description: "", active: true, sortOrder: products.length * 10 + 10 };
  const [editing, setEditing] = useState<Product | null>(null);
  const save = async () => { if (!editing) return; try { await api("/api/admin/products", { method: editing.id ? "PATCH" : "POST", body: JSON.stringify(editing) }); setEditing(null); await onSaved(); } catch (error) { notify((error as Error).message); } };
  return <div className="split-layout">
    <section className="panel data-panel">
      <div className="panel-head"><div><p className="eyebrow">PRODUCT CATALOG</p><h2>상품과 재고</h2></div><button className="button button-primary" onClick={() => setEditing(blank)}>+ 상품 추가</button></div>
      <div className="product-admin-grid">{products.map((product) => <button className={`product-admin-card ${!product.active ? "inactive" : ""}`} key={product.id} onClick={() => setEditing(product)}>
        <span className="product-glyph"><img src={productImage(product.id)} alt="" onError={(event) => { event.currentTarget.src = "/visuals/icons/products.webp"; }} /></span><div><small>{product.category} · {product.unit}</small><b>{product.name}</b><strong>{won(product.price)}</strong></div><em className={product.stock <= product.lowStockAt ? "low" : ""}>{product.stock}개</em>
      </button>)}</div>
    </section>
    {editing && <aside className="editor-panel"><div className="panel-head"><h2>{editing.id ? "상품 수정" : "새 상품"}</h2><button className="round-button" onClick={() => setEditing(null)}>×</button></div>
      <Field label="상품명"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
      <div className="form-row"><Field label="분류"><input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field><Field label="판매단위"><input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></Field></div>
      <div className="form-row"><Field label="판매가"><input type="number" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></Field><Field label="현재 재고"><input type="number" value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} /></Field></div>
      <Field label="재고 알림 기준"><input type="number" value={editing.lowStockAt} onChange={(e) => setEditing({ ...editing, lowStockAt: Number(e.target.value) })} /></Field>
      <Field label="상품 설명"><textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
      <div className="switch-row"><span><label htmlFor="product-active">판매 상태</label><small>고객 주문서에 상품을 표시합니다.</small></span><input id="product-active" aria-label="판매 상태" type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /></div>
      <button className="button button-primary button-full" onClick={save}>상품 저장</button>
    </aside>}
  </div>;
}

function FormBuilder({ form, products, onChange, onSave, busy }: { form: FormConfig | null; products: Product[]; onChange: (form: FormConfig) => void; onSave: () => void; busy: boolean }) {
  if (!form) return <LoadingState />;
  const selected = new Set(form.productIds);
  const toggle = (id: string) => onChange({ ...form, productIds: selected.has(id) ? form.productIds.filter((productId) => productId !== id) : [...form.productIds, id] });
  return <div className="builder-layout">
    <section className="panel form-panel"><div className="panel-head"><div><p className="eyebrow">FORM SETTINGS</p><h2>주문서 기본 설정</h2></div><span className={`state-chip ${form.active ? "on" : ""}`}>{form.active ? "공개 중" : "비공개"}</span></div>
      <Field label="주문서 제목"><input value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} /></Field>
      <Field label="상단 안내문"><textarea value={form.notice} onChange={(e) => onChange({ ...form, notice: e.target.value })} /></Field>
      <div className="form-row"><Field label="최소 주문금액"><input type="number" value={form.minOrderAmount} onChange={(e) => onChange({ ...form, minOrderAmount: Number(e.target.value) })} /></Field><Field label="기본 배송비"><input type="number" value={form.shippingFee} onChange={(e) => onChange({ ...form, shippingFee: Number(e.target.value) })} /></Field></div>
      <Field label="무료배송 기준"><input type="number" value={form.freeShippingAt} onChange={(e) => onChange({ ...form, freeShippingAt: Number(e.target.value) })} /></Field>
      <div className="switch-row"><span><label htmlFor="form-active">주문서 공개</label><small>끄면 고객이 주문서를 열 수 없습니다.</small></span><input id="form-active" aria-label="주문서 공개" type="checkbox" checked={form.active} onChange={(e) => onChange({ ...form, active: e.target.checked })} /></div>
      <div className="link-preview"><span>고객 링크</span><code>/order/{form.slug}</code><Link href={`/order/${form.slug}`} target="_blank">미리보기 ↗</Link></div>
    </section>
    <section className="panel form-products"><div className="panel-head"><div><p className="eyebrow">ITEMS</p><h2>판매 상품 선택</h2></div><b>{form.productIds.length}개 선택</b></div>
      <div className="select-product-list">{products.map((product) => <label key={product.id} className={selected.has(product.id) ? "selected" : ""}><input aria-label={`주문서에 ${product.name} 포함`} type="checkbox" checked={selected.has(product.id)} onChange={() => toggle(product.id)} /><span className="product-glyph"><img src={productImage(product.id)} alt="" onError={(event) => { event.currentTarget.src = "/visuals/icons/products.webp"; }} /></span><div><b>{product.name}</b><small>{won(product.price)} · 재고 {product.stock}</small></div></label>)}</div>
      <button className="button button-primary button-full" onClick={onSave} disabled={busy}>{busy ? "저장 중..." : "주문서 저장"}</button>
    </section>
  </div>;
}

function CustomersView({ customers }: { customers: Customer[] }) {
  return <section className="panel data-panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMERS</p><h2>고객 주문 이력</h2></div><span className="state-chip on">{customers.length}명</span></div>
    <div className="customer-grid">{customers.map((customer) => <article key={customer.id}><span className="customer-avatar"><img src="/visuals/icons/customers.webp" alt="" /></span><div><b>{customer.name}</b><small>{customer.phone}</small><p>{customer.address || "저장된 주소 없음"}</p></div><dl><div><dt>주문</dt><dd>{customer.orderCount}회</dd></div><div><dt>누적</dt><dd>{won(customer.totalSpent)}</dd></div><div><dt>최근</dt><dd>{shortTime(customer.lastOrderedAt)}</dd></div></dl></article>)}</div>
    {!customers.length && <EmptyState text="첫 주문이 접수되면 고객이 자동으로 등록됩니다." />}
  </section>;
}

function AnalyticsView({ dashboard }: { dashboard: Dashboard | null }) {
  if (!dashboard) return <LoadingState />;
  const totalQuantity = dashboard.topProducts.reduce((sum, item) => sum + Number(item.quantity), 0);
  return <div className="analytics-layout"><section className="panel analytics-hero"><p className="eyebrow">REVENUE SNAPSHOT</p><h2>오늘 매출</h2><strong>{won(dashboard.metrics.salesToday)}</strong><p>접수된 주문의 총액입니다. 실제 정산액은 결제 확인 상태와 함께 관리하세요.</p></section><section className="panel"><div className="panel-head"><h2>상품별 주문 비중</h2><b>{totalQuantity}개</b></div><div className="donut-list">{dashboard.topProducts.map((item, index) => <div key={item.name}><span style={{ background: ["#1f5eff", "#11a66a", "#7b55d9", "#ef9d2d", "#df5c5c"][index] }} /><b>{item.name}</b><em>{totalQuantity ? Math.round((item.quantity / totalQuantity) * 100) : 0}%</em></div>)}</div></section><section className="panel analytics-note"><h2>정확한 분석을 위한 원칙</h2><p>매출은 주문 접수 총액과 입금 확인액을 분리해 보세요. 취소 주문은 자동으로 운영 흐름에서 제외하도록 확장할 수 있습니다.</p><div><span>결제 연동</span><b>연결 안 됨</b></div></section></div>;
}

function SettingsView({ settings, onChange, onSave, busy }: { settings: ShopSettings | null; onChange: (settings: ShopSettings) => void; onSave: () => void; busy: boolean }) {
  if (!settings) return <LoadingState />;
  return <div className="settings-layout"><section className="panel form-panel"><div className="panel-head"><div><p className="eyebrow">SHOP PROFILE</p><h2>상점 기본 정보</h2></div></div>
    <Field label="상점명"><input value={settings.name} onChange={(e) => onChange({ ...settings, name: e.target.value })} /></Field><Field label="한 줄 소개"><input value={settings.tagline} onChange={(e) => onChange({ ...settings, tagline: e.target.value })} /></Field><Field label="고객 문의 연락처"><input value={settings.phone} onChange={(e) => onChange({ ...settings, phone: e.target.value })} /></Field><Field label="결제 안내"><textarea value={settings.paymentGuide} onChange={(e) => onChange({ ...settings, paymentGuide: e.target.value })} /></Field><Field label="주문 완료 안내"><textarea value={settings.orderCompleteMessage} onChange={(e) => onChange({ ...settings, orderCompleteMessage: e.target.value })} /></Field><button className="button button-primary" onClick={onSave} disabled={busy}>{busy ? "저장 중..." : "설정 저장"}</button></section>
    <section className="panel integration-panel"><div className="panel-head"><div><p className="eyebrow">INTEGRATIONS</p><h2>외부 서비스</h2></div></div>{[["문자 발송", "고객 알림과 배송 완료 안내", "연결 안 됨", "forms"], ["온라인 결제", "카드·간편결제 승인", "연결 안 됨", "payment"], ["카카오 알림", "주문 링크와 상태 알림", "연결 안 됨", "delivery"]].map((item) => <div className="integration-row" key={item[0]}><span><img src={`/visuals/icons/${item[3]}.webp`} alt="" /></span><div><b>{item[0]}</b><small>{item[1]}</small></div><em>{item[2]}</em></div>)}<p className="truth-note">연결되지 않은 서비스는 성공한 것처럼 표시하지 않습니다. 공급자 키는 서버에서만 보관하도록 확장합니다.</p></section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function LoadingState() { return <div className="loading-state"><i /><p>운영 데이터를 불러오고 있습니다.</p></div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><span><img src="/visuals/icons/inventory.webp" alt="" /></span><p>{text}</p></div>; }
