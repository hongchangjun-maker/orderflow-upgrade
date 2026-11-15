"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { liveRequest, operationId } from "../modules/live-client/client";
type Row = Record<string, unknown>;
type Snapshot = {
  seller: {
    mname: string;
    role: string;
  };
  forms: Row[];
  customers: Row[];
  staff: Row[];
  plans: Row[];
  deposits: Row[];
};
export function Workspace() {
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(operationId);
  const load = useCallback(
    () =>
      liveRequest<Snapshot>("/api/replica/workspace")
        .then(setData)
        .catch((e) => setMessage(e.message)),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const submit = async (
    event: React.FormEvent<HTMLFormElement>,
    path: string,
  ) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      input = Object.fromEntries(new FormData(form));
    setBusy(true);
    setMessage("");
    try {
      await liveRequest(`/api/replica/${path}`, {
        ...input,
        operation,
        idempotencyKey: operation,
      });
      setOperation(operationId());
      setMessage("서버 저장을 완료했습니다.");
      form.reset();
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="live-workspace">
      <header>
        <p>ORDERFLOW · 실제 운영</p>
        <h1>{data?.seller.mname ?? "상점"} 업무 설정</h1>
        <Link href="/replica">원본형 운영 화면으로 →</Link>
        <p>
          문자·은행·카카오·현금영수증의 외부 연동은 연결 대기입니다. 아래 자료는
          실제 서버에 저장됩니다.
        </p>
      </header>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section>
        <h2>고객 주문서 링크</h2>
        <p>
          주문서를 만들고 고객 링크를 공유하면 제출된 주문이 원본형 운영
          화면으로 들어옵니다.
        </p>
        {data?.forms.map((f) => (
          <article key={String(f.uocode)}>
            <b>{String(f.title ?? f.uname)}</b>{" "}
            <a href={String(f.url)} target="_blank" rel="noreferrer">
              고객 주문서 열기
            </a>{" "}
            <small>
              #{String(f.uocode)} · {String(f.order_cnt ?? 0)}건
            </small>
          </article>
        ))}
        <form onSubmit={(e) => submit(e, "workspace/form")}>
          <h3>새 주문서 만들기</h3>
          <label>
            주문서 제목
            <input name="title" required placeholder="오늘의 청과 주문서" />
          </label>
          <label>
            안내
            <textarea name="notice" />
          </label>
          <label>
            배송비
            <input
              name="shippingFee"
              type="number"
              min="0"
              defaultValue="0"
              required
            />
          </label>
          <label>
            품목 (한 줄에 품목명 | 단위 | 가격 | 재고)
            <textarea
              name="itemsText"
              required
              rows={5}
              placeholder={
                "사과 | 박스 | 20000 | 100\n감귤 | 박스 | 15000 | 200"
              }
            />
          </label>
          <button disabled={busy}>서버에 주문서 저장</button>
        </form>
      </section>
      <section>
        <h2>포인트·선결제 거래 원장</h2>
        <p>
          잔액보다 큰 차감은 서버에서 거절하며, 같은 처리 식별자의 재시도는 중복
          반영하지 않습니다.
        </p>
        <form onSubmit={(e) => submit(e, "customers/ledger")}>
          <label>
            고객 휴대폰
            <input name="mobile" required inputMode="tel" />
          </label>
          <label>
            종류
            <select name="kind">
              <option value="point">포인트</option>
              <option value="prepay">선결제</option>
            </select>
          </label>
          <label>
            증감액 (차감은 음수)
            <input name="delta" type="number" required />
          </label>
          <label>
            사유
            <input name="memo" required />
          </label>
          <button disabled={busy}>거래 기록</button>
        </form>
        {data?.customers.map((c) => (
          <p key={String(c.mobile)}>
            {String(c.cust_name)} · {String(c.mobile)} · 선결제{" "}
            {Number(c.remain_amt).toLocaleString()}원 · 포인트{" "}
            {Number(c.remain_point).toLocaleString()}
          </p>
        ))}
      </section>
      {data?.seller.role === "OWNER" && (
        <section>
          <h2>직원 계정</h2>
          <form onSubmit={(e) => submit(e, "staff")}>
            <label>
              직원 이름
              <input name="name" required autoComplete="off" />
            </label>
            <label>
              직원 아이디
              <input name="login" required autoComplete="off" />
            </label>
            <label>
              초기 비밀번호 (10자 이상)
              <input
                name="password"
                type="password"
                minLength={10}
                required
                autoComplete="new-password"
              />
            </label>
            <button disabled={busy}>직원 계정 생성</button>
          </form>
          <p>권한은 원본형 화면의 ‘설정 → 아이디·권한’에서 변경합니다.</p>
          {data.staff.map((s) => (
            <p key={String(s.id)}>
              {String(s.name)} · {String(s.login)} · {String(s.role)}
            </p>
          ))}
        </section>
      )}
      <section>
        <h2>수동 입금 내역</h2>
        <p>
          은행 자동 조회는 연결 대기입니다. 수동 기록과 주문 입금 확인은 지금
          사용할 수 있습니다.
        </p>
        <form onSubmit={(e) => submit(e, "deposit/manual")}>
          <label>
            입금자
            <input name="tran_name" required />
          </label>
          <label>
            입금액
            <input name="tran_amt" type="number" min="1" required />
          </label>
          <label>
            메모
            <input name="memo" />
          </label>
          <button disabled={busy}>입금 기록 저장</button>
        </form>
        {data?.deposits.map((d) => (
          <p key={String(d.id)}>
            {String(d.tran_name)} · {Number(d.tran_amt).toLocaleString()}원 ·{" "}
            {d.matched ? "매칭 완료" : "미매칭"}
          </p>
        ))}
      </section>
      <section>
        <h2>배송 계획</h2>
        <p>
          원본형 주문 화면에서 배송지를 선택해 배송 차수를 저장할 수 있습니다.
          외부 지도 자동 주소 변환은 연결 대기입니다.
        </p>
        {data?.plans.map((p) => (
          <article key={String(p.id)}>
            <b>
              {String(p.teamName)} · {String(p.orderDate)}
            </b>{" "}
            <span>
              {String(p.doneStopCnt ?? 0)}/{String(p.stopCnt ?? 0)}곳
            </span>
            {Boolean(p.shareToken) && (
              <a
                href={`/dispatch/${p.shareToken}`}
                target="_blank"
                rel="noreferrer"
              >
                기사 배송 링크
              </a>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
