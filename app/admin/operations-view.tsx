"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { messageBytes } from "../modules/messages/templates";
import { adminApi } from "./client-api";

type Candidate = { id: string; orderNo: string; customerName: string; customerPhone: string; address: string; addressDetail: string; status: string; total: number; createdAt: string };
type Run = { id: string; serviceDate: string; title: string; status: string; stopCount: number; deliveredCount: number; failedCount: number; createdBy: string };
type Stop = { id: string; runId: string; orderId: string; sequence: number; status: string; note: string; orderNo: string; customerName: string; customerPhone: string; address: string; addressDetail: string; total: number };
type Template = { id: string; name: string; kind: "INFO" | "AD"; body: string; active: boolean; updatedAt: string };
type Outbox = { id: string; templateId: string | null; recipientName: string; recipientPhone: string; body: string; status: string; provider: string; createdAt: string };

const todayKst = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const runLabels: Record<string, string> = { planned: "출발 전", running: "배송 중", completed: "완료", cancelled: "취소" };
const stopLabels: Record<string, string> = { waiting: "대기", out_for_delivery: "배송 중", delivered: "배송 완료", failed: "실패", held: "보류" };

export function OperationsView({ notify }: { notify: (value: string) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [serviceDate, setServiceDate] = useState(todayKst());
  const [runTitle, setRunTitle] = useState(`${todayKst()} 배송`);
  const [busy, setBusy] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [templateId, setTemplateId] = useState("");

  const load = useCallback(async () => {
    try {
      const [operations, messages] = await Promise.all([
        adminApi<{ candidates: Candidate[]; runs: Run[]; stops: Stop[] }>("/api/admin/operations"),
        adminApi<{ templates: Template[]; outbox: Outbox[]; providerConfigured: boolean }>("/api/admin/messages"),
      ]);
      setCandidates(operations.candidates); setRuns(operations.runs); setStops(operations.stops);
      setTemplates(messages.templates.map((item) => ({ ...item, active: Boolean(item.active) })));
      setOutbox(messages.outbox); setProviderConfigured(messages.providerConfigured);
      setSelected((current) => current.filter((id) => operations.candidates.some((item) => item.id === id)));
    } catch (error) { notify((error as Error).message); }
  }, [notify]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const createRun = async () => {
    if (!selected.length) return notify("배송할 주문을 먼저 선택해 주세요.");
    setBusy(true);
    try {
      await adminApi("/api/admin/operations", { method: "POST", body: JSON.stringify({ serviceDate, title: runTitle, orderIds: selected }) });
      notify(`${selected.length}건의 배송 작업을 만들었습니다.`); setSelected([]); await load();
    } catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  };
  const updateRun = async (runId: string, status: string) => {
    setBusy(true);
    try { await adminApi("/api/admin/operations", { method: "PATCH", body: JSON.stringify({ action: "run-status", runId, status }) }); await load(); notify("배송 작업 상태를 변경했습니다."); }
    catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  };
  const updateStop = async (stopId: string, status: string) => {
    setBusy(true);
    try { await adminApi("/api/admin/operations", { method: "PATCH", body: JSON.stringify({ action: "stop-status", stopId, status }) }); await load(); notify("배송지 상태를 변경했습니다."); }
    catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  };
  const chooseTemplate = (template: Template) => { setTemplateId(template.id); setMessageBody(template.body); };
  const saveTemplate = async () => {
    if (!editingTemplate) return;
    setBusy(true);
    try { await adminApi("/api/admin/messages", { method: "POST", body: JSON.stringify({ action: "template", ...editingTemplate }) }); await load(); setEditingTemplate(null); notify("메시지 템플릿을 저장했습니다."); }
    catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  };
  const saveDraft = async () => {
    setBusy(true);
    try { await adminApi("/api/admin/messages", { method: "POST", body: JSON.stringify({ action: "draft", templateId, recipientName, recipientPhone, body: messageBody }) }); await load(); notify("발송하지 않고 안전하게 초안으로 저장했습니다."); }
    catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  };

  return <div className="operations-layout">
    <section className="panel operations-intro"><div><p className="eyebrow">FIELD OPERATIONS</p><h2>배송 작업과 고객 메시지</h2><p>주문을 배송 순서로 묶고 진행 상태를 관리합니다. 문자 공급자가 연결되기 전에는 메시지를 초안으로만 저장합니다.</p></div><span className={`provider-chip ${providerConfigured ? "on" : ""}`}>{providerConfigured ? "문자 공급자 설정 감지" : "문자 공급자 연결 안 됨"}</span></section>
    <section className="panel candidate-panel"><div className="panel-head"><div><p className="eyebrow">DELIVERY QUEUE</p><h2>배송 대기 주문</h2></div><b>{selected.length}건 선택</b></div>
      <div className="delivery-create"><input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} aria-label="배송 날짜" /><input value={runTitle} onChange={(event) => setRunTitle(event.target.value)} placeholder="배송 작업 이름" aria-label="배송 작업 이름" /><button className="button button-primary" onClick={createRun} disabled={busy || !selected.length}>배송 작업 만들기</button></div>
      <div className="candidate-list">{candidates.map((order) => <label key={order.id} className={selectedSet.has(order.id) ? "selected" : ""}><input type="checkbox" checked={selectedSet.has(order.id)} onChange={() => toggle(order.id)} /><span>{order.orderNo}<small>{order.customerName} · {order.customerPhone}</small></span><b>{order.address} {order.addressDetail}</b></label>)}</div>
      {!candidates.length && <div className="empty-state"><p>배송 작업에 추가할 주문이 없습니다.</p></div>}
    </section>
    <section className="panel runs-panel"><div className="panel-head"><div><p className="eyebrow">DELIVERY RUNS</p><h2>최근 배송 작업</h2></div></div>
      <div className="run-list">{runs.map((run) => <article key={run.id} className={`run-card ${run.status}`}><header><div><span>{run.serviceDate}</span><b>{run.title}</b><small>{run.deliveredCount}/{run.stopCount} 완료{run.failedCount ? ` · 실패 ${run.failedCount}` : ""}</small></div><em>{runLabels[run.status] ?? run.status}</em></header><div className="run-actions">{run.status === "planned" && <button onClick={() => updateRun(run.id, "running")} disabled={busy}>배송 시작</button>}{run.status === "running" && <button onClick={() => updateRun(run.id, "completed")} disabled={busy}>작업 완료</button>}</div><div className="stop-list">{stops.filter((stop) => stop.runId === run.id).map((stop) => <div key={stop.id}><span>{stop.sequence}</span><p><b>{stop.orderNo} · {stop.customerName}</b><small>{stop.address} {stop.addressDetail}</small></p><select value={stop.status} onChange={(event) => updateStop(stop.id, event.target.value)} disabled={busy} aria-label={`${stop.orderNo} 배송 상태`}>{Object.entries(stopLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}</div></article>)}</div>
      {!runs.length && <div className="empty-state"><p>아직 만든 배송 작업이 없습니다.</p></div>}
    </section>
    <section className="panel message-panel"><div className="panel-head"><div><p className="eyebrow">MESSAGE TEMPLATES</p><h2>고객 메시지 초안</h2></div><button className="button button-ghost" onClick={() => setEditingTemplate({ id: "", name: "", kind: "INFO", body: "", active: true, updatedAt: "" })}>+ 템플릿</button></div>
      <div className="template-list">{templates.map((template) => <button key={template.id} className={templateId === template.id ? "active" : ""} onClick={() => chooseTemplate(template)} onDoubleClick={() => setEditingTemplate(template)}><span>{template.kind === "AD" ? "광고" : "안내"}</span><b>{template.name}</b><small>{messageBytes(template.body)}바이트</small></button>)}</div>
      <div className="message-compose"><input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="받는 분 이름" aria-label="받는 분 이름" /><input inputMode="tel" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="휴대폰 번호" aria-label="휴대폰 번호" /><textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="메시지 내용을 입력하세요. {상점명}, {고객명}, {주문번호}, {주문링크} 변수를 사용할 수 있습니다." aria-label="메시지 내용" /><div><span>{messageBytes(messageBody)}바이트 · {messageBytes(messageBody) <= 90 ? "SMS" : "LMS"}</span><button className="button button-primary" onClick={saveDraft} disabled={busy}>초안 저장</button></div></div>
      <div className="outbox-list"><h3>최근 초안</h3>{outbox.map((message) => <div key={message.id}><p><b>{message.recipientName}</b><small>{message.recipientPhone} · 발송 안 됨</small></p><span>{message.body}</span><a href={`sms:${message.recipientPhone}?body=${encodeURIComponent(message.body)}`}>문자 앱에서 열기</a></div>)}</div>
    </section>
    {editingTemplate && <div className="modal-backdrop" role="presentation"><section className="editor-panel template-editor" role="dialog" aria-modal="true" aria-label="메시지 템플릿 편집"><div className="panel-head"><h2>메시지 템플릿</h2><button className="round-button" onClick={() => setEditingTemplate(null)}>×</button></div><label className="field"><span>템플릿 이름</span><input value={editingTemplate.name} onChange={(event) => setEditingTemplate({ ...editingTemplate, name: event.target.value })} /></label><label className="field"><span>분류</span><select value={editingTemplate.kind} onChange={(event) => setEditingTemplate({ ...editingTemplate, kind: event.target.value as "INFO" | "AD" })}><option value="INFO">정보 안내</option><option value="AD">광고</option></select></label><label className="field"><span>내용</span><textarea value={editingTemplate.body} onChange={(event) => setEditingTemplate({ ...editingTemplate, body: event.target.value })} /></label><p className="truth-note">광고 템플릿은 저장할 때 광고 표기와 수신거부 문구가 자동 보완됩니다.</p><button className="button button-primary button-full" onClick={saveTemplate} disabled={busy}>템플릿 저장</button></section></div>}
  </div>;
}
