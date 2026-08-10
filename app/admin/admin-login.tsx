"use client";

import { useState, type FormEvent } from "react";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "로그인하지 못했습니다.");
      window.location.replace("/admin");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="admin-login-form" onSubmit={submit}>
    <label><span>관리자 이메일</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label><span>비밀번호</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    {message && <p className="form-error" role="alert">{message}</p>}
    <button className="button button-primary button-large" disabled={busy}>{busy ? "확인하는 중…" : "운영 화면 열기"}</button>
  </form>;
}
