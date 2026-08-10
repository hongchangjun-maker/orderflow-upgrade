import { clearedSessionCookie } from "../../../lib/auth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookie() } });
}
