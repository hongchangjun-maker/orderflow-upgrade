"use client";
import { useCallback, useEffect, useState } from "react";
import { liveRequest } from "../modules/live-client/client";
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
  }[];
  room?: { status: string; shopName: string };
  stops?: {
    stopCode: string;
    address: string;
    customerName: string;
    stopStatus: string;
  }[];
};
export function PublicDetail({ kind, token }: { kind: string; token: string }) {
  const [data, setData] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await liveRequest<Detail>(`/api/live-public/${kind}/${token}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }, [kind, token]);
  useEffect(() => {
    const start = setTimeout(() => {
      void load();
    }, 0);
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [load]);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await liveRequest<{ url?: string }>(
        `/api/live-public/${kind}/${token}`,
        body,
      );
      if (result.url) window.location.assign(result.url);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
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
                <small>{m.createdAt}</small>
              </article>
            ))}
          </section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const content = new FormData(f).get("message");
              void send({ content });
              f.reset();
            }}
          >
            <label>
              메시지
              <input name="message" maxLength={5000} required />
            </label>
            <button disabled={busy || data.room?.status === "C"}>보내기</button>
          </form>
        </>
      ) : (
        <section>
          {data.stops?.map((s) => (
            <article key={s.stopCode}>
              <h2>{s.customerName}</h2>
              <p>{s.address}</p>
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
