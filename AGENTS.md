# ORDERFLOW independent replica contracts

- Source `https://xn--9y2bw0aj3kmoj8tj.kr/` is read-only. Never mutate it, migrate its customer/order records, or copy credentials.
- Existing Worker/D1/API, `/admin`, `/admin/secure`, and `/order/fresh-market` contracts remain unchanged. The former landing page is preserved at `/overview`.
- `/replica` is the reconstructed user-owned shipped frontend. Its local-only adapter is NOT production authentication and must never be accepted by a server.
- `public/replica-assets/application.js` and `reference.css` are generated artifacts. Do not hand edit them. Use `scripts/prepare-reference-replica.mjs` with explicit source directory and pinned SHA-256.
- Ownership: `model.mjs` pure fixture/rules; `runtime.mjs` isolated storage/Axios simulation adapter/composition; generated application presentation; `worker/index.ts` network security; route.ts HTML composition.
- Replica CSP must contain `connect-src 'none'`, `form-action 'none'`; no original network connections, notification permissions, or unnamespaced source storage.
- Unsupported mutations must fail visibly; never simulate financial, bank, SMS, tax-receipt, account, or identity operations as real success.
- Mandatory checks: `npm run typecheck`, `npm run lint`, `npm test`, `node --test tests/replica.test.mjs`. Browser checks: dashboard, every normal sidebar route, order fixture/search, state reload, CSV, orange palette, no source request, no console uncaught errors. Desktop and 390px mobile; original dense table horizontal scroll is allowed inside the table, not across the entire page.
- Backend equivalence is unverified until original server contracts and independent provider integrations are available. Preserve this limitation in docs and UI.
- Rollback: deploy previous Worker version; no D1 migration in this reconstruction. Keep source release provenance and generated hash together.
