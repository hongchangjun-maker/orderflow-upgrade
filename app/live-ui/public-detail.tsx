"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { liveRequest,liveUpload } from "../modules/live-client/client";
type Detail = {
  orderNo?: number;
  status?: string;
  ispaid?: string;
  total?: number;
  shopName?: string;
  items?: { name: string; quantity: number; unit: string }[];
  messages?: {
    msgId: number;
    sender: string;
    content: string;
    createdAt: string;
    type?:string;fileUrl?:string;fileName?:string;readAt?:string;
  }[];
  room?: { status: string; shopName: string };
  stops?: {
    stopCode: string;
    address: string;
    customerName: string;
    stopStatus: string;
    addr?:string;label?:string;orderCount?:number;
  }[];
};
export function PublicDetail({ kind, token }: { kind: string; token: string }) {
  const [data, setData] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reading=useRef(false);
  const load = useCallback(async (signal?:AbortSignal) => {
    if(reading.current)return;
    reading.current=true;
    try {
      const next=await liveRequest<Detail>(`/api/live-public/${kind}/${token}`,undefined,{signal});
      if(!signal?.aborted)setData(next);
    } catch (e) {
      if(!signal?.aborted)setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }finally{
      reading.current=false;
    }
  }, [kind, token]);
  useEffect(() => {
    const controller=new AbortController();
    const start = setTimeout(() => {
      void load(controller.signal);
    }, 0);
    const timer = setInterval(() => {
      if(!document.hidden)void load(controller.signal);
    }, kind==='chat'?3000:15000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
      controller.abort();
    };
  }, [load,kind]);
  const send = async (body: Record<string, unknown>) => {
    if(busy)return false;
    setBusy(true);
    setError("");
    try {
      const result = await liveRequest<{ url?: string }>(
        `/api/live-public/${kind}/${token}`,
        body,
      );
      if (result.url) window.location.assign(result.url);
      else await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="live-public">
      <h1>
        {kind === "receipt"
          ? "주문 접수 확인"
          : kind === "chat"
            ? "매장과 대화"
            : "배송 진행"}
      </h1>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>불러오는 중…</p>
      ) : kind === "receipt" ? (
        <>
          <h2>
            {data.shopName} · 주문 #{data.orderNo}
          </h2>
          <p>
            처리 상태:{" "}
            {
              (
                {
                  "00": "접수 대기",
                  "10": "접수",
                  "22": "포장",
                  "24": "배송",
                  "30": "완료",
                  "40": "취소",
                } as Record<string, string>
              )[data.status ?? ""]
            }
          </p>
          <p>{data.ispaid === "Y" ? "입금 확인 완료" : "입금 확인 대기"}</p>
          {data.items?.map((i, index) => (
            <p key={index}>
              {i.name} {i.quantity}
              {i.unit}
            </p>
          ))}
          <strong>{data.total?.toLocaleString()}원</strong>
          <p>
            이 확인 링크를 보관해 주세요. 새로고침해도 주문은 다시 생성되지
            않습니다.
          </p>
          <button disabled={busy} onClick={() => send({})}>
            매장에 문의하기
          </button>
          <button onClick={() => window.print()}>주문서 인쇄</button>
        </>
      ) : kind === "chat" ? (
        <>
          <h2>{data.room?.shopName}</h2>
          <section aria-live="polite">
            {data.messages?.map((m) => (
              <article key={m.msgId}>
                <b>{m.sender === "C" ? "나" : "매장"}</b>
                <p>{m.content}</p>
                {m.fileUrl&&<p><a href={m.fileUrl} target="_blank" rel="noreferrer">{m.type==='image'?'사진 열기':m.fileName||'첨부파일 다운로드'}</a></p>}
                {m.sender==='C'&&<small>{m.readAt?'읽음':'미확인'} · </small>}
                <small>{m.createdAt}</small>
              </article>
            ))}
          </section>
          <form
            onSubmit={async(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const content = new FormData(f).get("message");
              if(await send({ content }))f.reset();
            }}
          >
            <label>
              메시지
              <input name="message" maxLength={5000} required />
            </label>
            <button disabled={busy || data.room?.status === "C"}>보내기</button>
          </form>
          <label>사진·파일 첨부 (최대 10MB)
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv" disabled={busy||data.room?.status==='C'} onChange={async event=>{
              const input=event.currentTarget,file=input.files?.[0];if(!file)return;
              setBusy(true);setError('');
              try{
                if(file.size>10_000_000)throw new Error('파일은 10MB 이하로 선택해 주세요.');
                const result=await liveUpload<Record<string,unknown>>(`/api/live-public/chat/${token}/upload`,file);
                await liveRequest(`/api/live-public/chat/${token}`,{type:result.kind==='image'?'image':'file',content:result.fileName,...result});
                await load();input.value='';
              }catch(error){setError(error instanceof Error?error.message:'첨부 실패');}finally{setBusy(false);}
            }}/>
          </label>
        </>
      ) : (
        <section>
          {data.stops?.map((s) => (
            <article key={s.stopCode}>
              <h2>{s.label??s.customerName}</h2>
              <p>{s.addr??s.address}</p>
              {s.orderCount&&<p>주문 {s.orderCount}건</p>}
              <button
                disabled={busy || s.stopStatus === "30"}
                onClick={() => send({ stopCode: s.stopCode })}
              >
                {s.stopStatus === "30" ? "배송 완료" : "완료 처리"}
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
