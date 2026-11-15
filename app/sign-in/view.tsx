"use client";
import { useState } from "react";
import { liveRequest } from "../modules/live-client/client";
export function LiveLogin() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">ORDERFLOW · LIVE</p>
        <h1>
          링크주문서
          <br />
          운영 로그인
        </h1>
        <p>실제 주문과 고객 정보는 인증된 매장 계정만 열 수 있습니다.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await liveRequest("/api/replica/login", {
                email: f.get("email"),
                password: f.get("password"),
              });
              window.location.assign("/replica");
            } catch (err) {
              setError(err instanceof Error ? err.message : "로그인 실패");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            아이디 또는 이메일
            <input
              name="email"
              autoComplete="username"
              required
              aria-label="아이디 또는 이메일"
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-label="비밀번호"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="button button-gold" disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}
