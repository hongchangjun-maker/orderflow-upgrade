"use client";

import { useCallback, useEffect, useState } from "react";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "../modules/customers/segments";
import { adminApi } from "./client-api";

type Customer = {
  id: string; name: string; phone: string; address: string; orderCount: number; totalSpent: number;
  points: number; lastOrderedAt: string | null; segment: CustomerSegment;
};
type Summary = Record<CustomerSegment, number> & { total: number };

const won = (value: number) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const shortTime = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "주문 없음";

export function CustomersView({ notify }: { notify: (value: string) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [segment, setSegment] = useState<CustomerSegment | "all">("all");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cursor = "", append = false) => {
    setLoading(true);
    try {
      const data = await adminApi<{ customers: Customer[]; summary: Summary; nextCursor: string | null }>(`/api/admin/customers?segment=${segment}&q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`);
      setCustomers((current) => append ? [...current, ...data.customers.filter((item) => !current.some((existing) => existing.id === item.id))] : data.customers);
      setSummary(data.summary);
      setNextCursor(data.nextCursor);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [notify, query, segment]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  return <section className="panel data-panel">
    <div className="panel-head"><div><p className="eyebrow">CUSTOMER SEGMENTS</p><h2>고객 관계 관리</h2></div><span className="state-chip on">전체 {Number(summary?.total ?? 0).toLocaleString()}명</span></div>
    <div className="segment-summary">
      <button className={segment === "all" ? "active" : ""} onClick={() => setSegment("all")}><b>전체</b><strong>{summary?.total ?? 0}</strong><small>등록 고객</small></button>
      {(Object.keys(CUSTOMER_SEGMENTS) as CustomerSegment[]).map((key) => <button key={key} className={segment === key ? "active" : ""} onClick={() => setSegment(key)}><b>{CUSTOMER_SEGMENTS[key].label}</b><strong>{summary?.[key] ?? 0}</strong><small>{CUSTOMER_SEGMENTS[key].description}</small></button>)}
    </div>
    <div className="customer-toolbar"><div className="search-box"><input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && setQuery(queryDraft.trim())} placeholder="고객명, 휴대폰, 주소 검색" aria-label="고객 검색" /><button onClick={() => setQuery(queryDraft.trim())}>검색</button></div><small>세그먼트는 주문 횟수·누적액·최근 주문일로 자동 계산됩니다.</small></div>
    {loading && !customers.length ? <div className="loading-state"><i /><p>고객 데이터를 분류하고 있습니다.</p></div> : <div className="customer-grid">{customers.map((customer) => <article key={customer.id}>
      <span className="customer-avatar"><img src="/visuals/icons/customers.webp" alt="" /></span><div><span className={`segment-chip ${customer.segment}`}>{CUSTOMER_SEGMENTS[customer.segment].label}</span><b>{customer.name}</b><small>{customer.phone}</small><p>{customer.address || "저장된 주소 없음"}</p></div><dl><div><dt>주문</dt><dd>{customer.orderCount}회</dd></div><div><dt>누적</dt><dd>{won(customer.totalSpent)}</dd></div><div><dt>최근</dt><dd>{shortTime(customer.lastOrderedAt)}</dd></div></dl>
    </article>)}</div>}
    {!loading && !customers.length && <div className="empty-state"><span><img src="/visuals/icons/customers.webp" alt="" /></span><p>조건에 맞는 고객이 없습니다.</p></div>}
    {nextCursor && <div className="load-more-row"><button className="button button-ghost" onClick={() => load(nextCursor, true)} disabled={loading}>고객 60명 더 보기</button></div>}
  </section>;
}
