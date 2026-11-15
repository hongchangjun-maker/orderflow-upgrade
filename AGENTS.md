# ORDERFLOW independent production contracts

- NEVER access or mutate the original site, its account, credentials or customer/order data. Only this independent repository, Worker, D1 and media buckets are writable.
- Preserve generated orange presentation bytes and routes. `application.js` SHA is pinned in provenance. Runtime transport replacement is intentional and authorized; no source server calls.
- Preserve old `/admin`, `/admin/secure`, `/order/fresh-market`, `/overview` and legacy API/schema contracts.
- Ownership: `live/domain.ts` and `schedule.ts` pure rules; `store.ts` D1 persistence/CAS; feature services own server use cases; `context.ts` tenant/permission authority; `router.ts` HTTP/CSRF composition; `live-client` browser HTTP port; `live-ui`/workspace presentation; runtime Axios composition only; worker CSP/schedules. No UI imports server modules or database SDKs. No import cycles.
- Every seller call requires actual HttpOnly server session and shop scoping. UI access markers/localStorage are not authority. `LOCAL_ADMIN_BYPASS` is forbidden in deployed environment; production must ignore it even if present.
- `of_` schema is new and separate. Manual SQL migrations 0006+ own it; do not use drizzle push or migrate old tables. Use additive reviewed migrations and D1 Time Travel rollback.
- Stock triggers + D1 atomic batches own inventory. Money uses append-only idempotent ledger and nonnegative trigger. Persisted revisions/CAS detect edits; never silently overwrite stock from JSON.
- Provider calls are deferred. Return `provider_not_configured`, never fake delivery/payment/receipt success. No paid contract, charge, real SMS, or bank requests without new direction.
- Images: own R2, JPG/PNG/WebP max 2MB; public opaque product-image links, not private document storage. Rich text is sanitized server-side.
- Checks: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, `node --test tests/rendered-html.test.mjs`, `npm audit --omit=dev`. `npm run test:live` only on local or separate staging synthetic data. Never load-test production or original.
- Staging: `node scripts/verify-staging.mjs` applies only staging migrations, replaces only staging test credentials in memory, deploys staging and tests real HTTP. Production deploy is explicit and requires passing staging first. Existing production admin credentials are unchanged.
- Browser QA: own local/staging customer submission -> receipt -> chat -> admin order/reload, desktop and 390px. Report measured limits separately from functionality; 100-customer burst is not proof of tens of thousands.
- Rollback: previous Worker version `adc2f309-5198-4665-a286-b9e4ccfcb00b`; preserve `of_` data on rollback. Do not drop tables, reset Git or erase user changes. Release evidence/limitations in docs/LIVE-RELEASE.md.
