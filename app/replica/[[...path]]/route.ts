// Composition only. The shipped UI is isolated from every operational API by CSP.
export const dynamic = "force-dynamic";
export function GET() {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>링크주문서 · 주황 독립 복제본</title><link rel="stylesheet" href="/replica-assets/reference.css"><link rel="stylesheet" href="/replica-assets/isolation.css"></head><body><div id="root"></div><script type="module" src="/replica-assets/application.js"></script></body></html>`, {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
