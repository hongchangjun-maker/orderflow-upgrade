import { context } from "../../modules/live/context";
import { REPLICA_ASSET_VERSION } from "../../modules/live/release";
import {publicTestEnabled} from '../../modules/live/test-mode';
// Authentication is enforced for the document AND every underlying API request.
export const dynamic = "force-dynamic";
export async function GET(request:Request) {
  let testMode=false;
  try{const current=await context(request);testMode=current.permissions.testMode===true;}catch{return Response.redirect(new URL(publicTestEnabled()?'/try':'/sign-in',request.url),303);}
  return new Response(`<!doctype html><html lang="ko" data-test-mode="${testMode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>링크주문서 · 실제 운영</title><link rel="stylesheet" href="/replica-assets/reference.css"><link rel="stylesheet" href="/replica-assets/isolation.css?v=${REPLICA_ASSET_VERSION}"></head><body><div id="root"></div><script type="module" src="/replica-assets/${REPLICA_ASSET_VERSION}/application.js"></script></body></html>`, {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
