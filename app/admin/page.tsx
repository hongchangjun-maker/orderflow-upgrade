import type { Metadata } from "next";
import { DemoAdminApp } from "./demo-admin-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주문 운영 시뮬레이션" };

export default function AdminPage() { return <DemoAdminApp />; }
