"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./client-api";

type Point = { date: string; orders: number; sales: number; paidSales: number };
type Analytics = { days: number; series: Point[]; summary: { orders: number; sales: number; paidSales: number; averageOrder: number; cancelled: number } };
const won = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;

export function AnalyticsView({ notify }: { notify: (value: string) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const load = useCallback(async () => {
    try { setData(await adminApi<Analytics>(`/api/admin/analytics?days=${days}`)); }
    catch (error) { notify((error as Error).message); }
  }, [days, notify]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (!data) return <div className="loading-state"><i /><p>매출 흐름을 계산하고 있습니다.</p></div>;
  const max = Math.max(...data.series.map((point) => point.sales), 1);
  const paidRate = data.summary.sales ? Math.round(data.summary.paidSales / data.summary.sales * 100) : 0;
  return <div className="analytics-dashboard">
    <section className="panel analytics-control"><div><p className="eyebrow">REVENUE ANALYTICS</p><h2>매출·입금 추세</h2></div><div className="filter-tabs">{[7, 30, 90].map((value) => <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>{value}일</button>)}</div></section>
    <section className="analytics-metrics"><article><span>주문 매출</span><strong>{won(data.summary.sales)}</strong><small>취소 제외</small></article><article><span>입금 확인</span><strong>{won(data.summary.paidSales)}</strong><small>{paidRate}% 확인</small></article><article><span>평균 주문</span><strong>{won(data.summary.averageOrder)}</strong><small>{data.summary.orders}건 기준</small></article><article><span>취소 주문</span><strong>{data.summary.cancelled}건</strong><small>선택 기간</small></article></section>
    <section className="panel sales-chart"><div className="panel-head"><div><p className="eyebrow">DAILY SALES</p><h2>일별 주문 매출</h2></div><span>금색: 입금 확인</span></div><div className="sales-bars">{data.series.map((point) => <div key={point.date} className="sales-bar"><div className="bar-stack" title={`${point.date} · ${won(point.sales)}`}><i style={{ height: `${Math.max(4, point.sales / max * 100)}%` }} /><b style={{ height: `${Math.max(0, point.paidSales / max * 100)}%` }} /></div><small>{point.date.slice(5)}</small><em>{point.orders}건</em></div>)}</div>{!data.series.length && <div className="empty-state"><p>선택 기간에 주문이 없습니다.</p></div>}</section>
    <section className="panel analytics-note"><h2>운영 기준</h2><p>주문 접수 매출과 실제 입금 확인액을 분리했습니다. 외부 결제 공급자가 연결되기 전에는 관리자가 확인한 입금 상태만 집계합니다.</p><div><span>결제 공급자</span><b>연결 안 됨</b></div></section>
  </div>;
}
