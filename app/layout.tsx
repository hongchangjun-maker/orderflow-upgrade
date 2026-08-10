import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "ORDERFLOW | 주문은 더 쉽게, 운영은 더 우아하게";
  const description = "실사 상품 주문서부터 실시간 재고, 주문 처리, 고객과 매출 관리까지 연결하는 프리미엄 주문 운영 플랫폼";
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: "%s | ORDERFLOW" },
    description,
    icons: { icon: "/visuals/orderflow-mark.webp", shortcut: "/visuals/orderflow-mark.webp" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.webp`, width: 1536, height: 1024, alt: "ORDERFLOW 주문 운영 플랫폼" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.webp`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${notoSansKr.variable} ${geistMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
