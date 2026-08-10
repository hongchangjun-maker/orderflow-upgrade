import type { Metadata } from "next";
import Link from "next/link";
import { getAdminUser } from "../lib/auth";
import { AdminApp } from "./admin-app";
import { AdminLogin } from "./admin-login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "운영 관리자" };

export default async function AdminPage() {
  const user = await getAdminUser();
  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <Link href="/" className="brand-lockup"><img src="/visuals/orderflow-mark.webp" alt="" /><span>ORDERFLOW</span></Link>
          <p className="eyebrow">SECURE OPERATION</p>
          <h1>운영자 전용<br />컨트롤 센터</h1>
          <p>주문·고객·매출 데이터는 서버에서 인증된 관리자만 확인할 수 있습니다.</p>
          <AdminLogin />
          <Link href="/order/fresh-market" className="text-link">고객 주문서로 이동 →</Link>
        </section>
      </main>
    );
  }
  return <AdminApp user={{ name: user.displayName, email: user.email }} />;
}
