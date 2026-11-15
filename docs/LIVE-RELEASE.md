# Independent live release — 2026-11-16

This is a new backend implementation, not a recovered copy of the original private server. Original site/account/data were not accessed or changed. Source UI bytes and orange palette are pinned in provenance. Previous reconstruction evidence remains historical in ORANGE-REPLICA-20261116.md.

## Active contracts

- `/replica`: source-faithful orange seller presentation, real HttpOnly server authentication. Browser storage holds optional UI preferences only.
- `/workspace`: owner setup, actual form/customer links, manual ledger, staff creation, deposit records and delivery plans.
- `/buy/:opaqueToken`: public customer form, server prices/stock/minimum amount/period/delivery validation, consent and durable idempotent order submission.
- `/receipt/:uuid`: scoped minimal order confirmation; `/contact/:opaqueToken`: scoped per-order customer chat; `/dispatch/:opaqueToken`: 48-hour driver capability link.
- Independent D1 `of_` tables own forms, catalog, customers, orders, line items, ledger, staff, sessions, records and audit changes. D1 batches roll back on guard/stock/balance failures. Indexes support shop/date, children, token and block lookups.
- Stock reservation/reversal and prepayment cancellation reversal use database triggers. No negative inventory or balance. Final completed/cancelled status cannot reopen. Paid line-item/price changes are rejected. Internal prepayment cancellation restores stored credit; this is NOT a bank refund.
- Source DTO compatibility includes form/item edit, CAS revisions, order item-name mapping, bulk status/payment, merge/replay, customer balance/history, permissions, shop settings, chat/templates/address book, recurring schedules and delivery plans. Unknown writes fail visibly.
- Own R2 product-image upload validates magic bytes, JPG/PNG/WebP and 2MB cap. Image links are public bearer URLs, not a private attachment/document vault. Rich-text HTML uses an allowlist sanitizer ([upstream docs](https://github.com/apostrophecms/sanitize-html)).
- Recurring orders run every 15 minutes in production with stable per-master/due-day idempotency; a failed schedule records its error. No SMS/Kakao/bank calls are involved. Cron invocation and long-running recurrence recovery require ongoing observation; save/compute/pause have HTTP tests.

## Deferred / explicit limits

User explicitly deferred SMS, Kakao/Alimtalk, bank automated lookup and cash receipt providers. No paid contract, charge, external send, actual payment capture or tax-receipt issue is executed. Provider writes return 503 `provider_not_configured`. Manual deposit confirmation and internal prepaid credit are available. External geocoding/road-time routing remains unconnected; coordinate-based nearest-neighbor ordering is internal, not a traffic-aware route guarantee.

Original master password changes remain in Cloudflare's existing secret configuration; employee password change/revocation is in the app. Master credentials were not replaced. Original customer page/server equivalence and every original proprietary/provider behavior are not verified. This release must not be represented as complete private-server equivalence.

Lists are bounded: up to 5,000 order/customer rows for a query, 2,000 generic record rows, 100 catalog types/order and 100 selected bulk orders. Use date/search filters. 100/300-customer synthetic bursts are evidence only for their measured workload, not proof of 50 businesses with tens of thousands of simultaneous customers. Further capacity qualification needs agreed peak targets, storage/usage budgets, monitoring and possibly per-shop database sharding/queue design. No unlimited capacity or SLA is promised.

## Verification and operation

`npm run typecheck`, `npm run lint`, `npm run check:architecture`, `npm run test:unit`, `npm run build`, `node --test tests/rendered-html.test.mjs`, `npm audit --omit=dev`.

`npm run test:live` tests actual HTTP/D1/R2 only in localhost or the explicitly named staging URL. It refuses any production/original URL. It checks idempotency, server pricing, atomic stock/balance, merge/cancel, staff authorization, chat, edit CAS, payment/deposit/dispatch, schedules and media. `scripts/verify-staging.mjs` replaces only staging test secrets in memory, checks two-owner isolation, deploys staging and runs this suite. No credentials or cookies are written to artifacts or Git.

Local Vite development burst: 100 customers × 20 items, 100 successes; p95 varied 19–30 seconds. Earlier Cloudflare staging burst: 100 × 20, 100 successes, p95 3,295ms. Final release measurements and Worker version are recorded below after validation. Single-stock contention: 30 requests for stock 10 -> exactly 10 accepted/20 rejected, zero remainder.

Manual migrations 0006–0009 affect only newly introduced independent `of_` tables. The older independent app API/schema/routes remain unchanged. Before production, review D1 ID and Worker/R2 names against wrangler.jsonc. Do not run drizzle push. Git branch is codex/production-order-system; generated presentation hashes are unchanged.

Rollback: deploy previous Worker version `adc2f309-5198-4665-a286-b9e4ccfcb00b`; leave `of_` data intact. That UI is the historical demo, so do not accept new live business orders during rollback. Restore data only through separately approved D1 Time Travel recovery. Monitor Worker 5xx/latency, D1 overload/row reads/writes, stock conflicts, failed schedules, expired sessions and media errors. Owner operates provider keys, credentials, retention policy and incident response. Existing submission/login records expire after 24h, change events 30d and staff sessions 12h; business records/ledger are retained.

Additional migration 0010 creates shop/order chat-room uniqueness. All 0006–0010 objects are independent `of_` objects. The owner-only `/api/replica/recurring-orders/run-due` invokes the production scheduler function scoped to the authenticated shop; HTTP tests verify one due order, zero on repeat, and pause. Actual Cron timing still needs ongoing observation.

Security refresh: React/React DOM/RSC 19.3.1, Vite 8.3.8, Wrangler 4.162.0, Cloudflare Vite plugin 1.69.1 and lockfile-resolved Vinext 1.4.5. The [RSC advisory](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) was checked before release. After updates: no high/critical advisory; `npm audit --omit=dev` reports 0. There remain 15 moderate development/transitive advisories (Drizzle tooling esbuild, OG stack fflate, ESLint minimatch); no untrusted ZIP/OG-generation endpoint is exposed. Do not claim every development dependency is advisory-free. CI now audits all dependencies at high severity in addition to the production audit.

Final pre-production evidence: typecheck/lint/architecture passed; unit 20/20 and actual Workers rendered/security 5/5 passed. Latest staging `21325d0a-af7e-45d2-9b34-9e848591ba4c`: 25 actual HTTP/D1/R2 checks passed, plus real master login/two-owner isolation. 300 simultaneous customers × 20 products -> 300 successful persisted orders, p95 8,015ms. Stock10/30-way contention -> 10 accepted, 20 rejected. No original/production load-test data was used. Desktop actual local form creation -> customer submission -> receipt -> seller list/reload and mobile order/chat at 390px were visually checked; no page-width overflow. Browser error logs were empty at final seller check. Production login with the owner's existing credential is not browser-E2E verified; those secrets were not extracted or replaced.

Production deployment evidence will be appended after deployment. Previous versions above are historical measurements, not an unlimited-traffic guarantee.
