import type { Metadata } from "next";
import Link from "next/link";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { getAdminUser } from "../lib/auth";
import { AdminApp } from "./admin-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "운영 관리자" };

export default async function AdminPage() {
  const user = await getAdminUser();
  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <Link href="/" className="brand-lockup"><span className="brand-mark">O</span><span>ORDERFLOW</span></Link>
          <p className="eyebrow">관리자 전용</p>
          <h1>운영 데이터는<br />운영자만 볼 수 있어요.</h1>
          <p>관리 화면과 고객 정보는 인증된 관리자에게만 열립니다.</p>
          <Link href={chatGPTSignInPath("/admin")} className="button button-primary button-large">ChatGPT로 안전하게 로그인</Link>
          <Link href="/order/fresh-market" className="text-link">고객 주문서로 이동 →</Link>
        </section>
      </main>
    );
  }
  return <AdminApp user={{ name: user.displayName, email: user.email }} />;
}
