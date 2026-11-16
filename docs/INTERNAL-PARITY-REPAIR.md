# Internal parity repair — 2026-11-16

## Boundary and acceptance

Only the independent checkout, GitHub repository, Worker, D1 `of_` objects and media storage may change. No requests to the original site/accounts/data. External SMS/Kakao/bank/tax/PG/geocoding/push providers remain disabled and must not return false success. Existing orange generated presentation hash and legacy routes/API remain frozen.

Branch: `codex/internal-parity-repair`; rollback live Worker `7390c7f7-e82a-4b7e-a6aa-bdfcf1e502f3`. Additive migrations only; retain existing independent business data and JSON compatibility. Never test write/load against production/original; use local/staging synthetic fixtures.

## Priority / owned streams

1. Catalog: inactive creation, persisted sort, KST lifecycle, date import and pagination/filter/CAS response. Owner catalog service and pure catalog rules.
2. Monetary correctness: pure delivery fee tiers/region/default payment rules, authoritative order total, point reservation/posting/reversal, idempotency/stock conflicts. Main owns rules, transactions, schema, authorization and public DTO wiring.
3. Dispatch/read/report: restore saved plans/order/status, true line-item totals, month/customer/date filters, complete exports and consistent KST metrics. Reporting stream owns read-only customer/dashboard projections, main owns dispatch and order mutations.
4. UI/chat/account: preserve source admin UI; customer options, item images/rich text, PIN-scoped customer history/points, actual chat settings/auto-reply/read state, internal account lifecycle/manual recovery without pretending SMS identity verification. Main owns all security and service wiring. SMS-based self-service original onboarding/recovery is external and stays gated.
5. Regression: pure tests + actual HTTP fixtures for every checklist row, concurrency/idempotency/tenant isolation, architecture/secret/asset checks, desktop/390px journeys, build, separate Cloudflare staging, then same verified artifact production and read-only postchecks. Audit each checklist item as fixed/tested/deferred/unknown; do not infer full original backend equality.

## Frozen public compatibility

Keep original source client success/error envelopes, field names and source routes listed in CONTRACT-INVENTORY.md. Internal additions are additive. Canonical saved order money JSON: `point_used` discount in won, `saved_point` earned credit, `adjustment` signed adjustment; `amount` remains gross product subtotal; payable=`amount+fee-point_used+adjustment`. Existing rows default missing fields to zero. Public point/prepay spending requires a scoped authenticated customer capability, never a submitted phone number alone.

## Recovery / operations

Before production: type/lint/unit/contract/architecture/build, review migrations, staging regression/load and browser proofs. Keep master secrets unchanged unless owner explicitly changes password in the new app. A stored new-app master credential must invalidate new-app old sessions without weakening the preserved legacy admin contract. Rollback code without deleting new data. Document exact measured workload, deployment version, remaining external/provider/hardware limitations.

## Implemented checklist / reasons

| Priority | Original difference / cause | Repair and proof |
| --- | --- | --- |
| P0 | Inactive insert ignored flag; sort reverted to ID | Canonical active flag + audited reconcile, persistent sort_index, KST live/soon/done/off, import date SQL/CAS current DTO. Catalog rules + HTTP inactive/reload tests. |
| P0 | Fixed-only fee, transfer-only payment, no order point accounting | Shared fee resolver (method → part → legacy), amount tiers, minimum, region/deny/free, store/prepay; atomic point/prepay debit and stock reservation. Pricing tests + real D1 quote/debit/cancel/concurrent order tests. |
| P0 | Phone input alone must not authorize another customer's money | Seller-issued random capability + throttled PIN + one-hour HttpOnly session; 1–90-day link expiry and revocation. Anonymous spending HTTP403 and real scoped spending tests. |
| P1 | Saved dispatch was reconstructed preview, duplicate plan numbers and first-item totals | Persist exact selected teams/stops, independent new record ID per plan, actual all-line qty/doneQty, startOnSave atomic24 transition, grouped-stop driver completion. HTTP save/detail/sum/start/driver tests. |
| P1 | Monthly endpoints returned general data; totals ignored discounts | SQL filters before page limits, source monthly and bulk DTOs, true line details/pivot export, KST customer stats, net totals and matched comparison periods. Report rules + monthly/export HTTP tests. |
| P1 | Recurring list omitted search; monthly count was master count | SQL search and actual generated order count, dynamic delivery/payment choices; stable recurring due-day idempotency retained. Existing real scheduler/run-once HTTP tests. |
| P1 | Customer options/details omitted from public DTO | Source cash_receipt_gbn/use_present/use_pickup_time/pickup_time_arr/fact fields, bounded quantity, own gallery and sanitized rich text; stock flag means imminent-sold-out badge, not exact count disclosure. HTTP DTO/sanitizer and browser form proof. |
| P1 | Chat settings, off-hours replies, read state were passive | Enforce enabled, Seoul hours, greeting/auto-reply once per five-minute room window, persisted two-sided read state/history/unread; own inquiry admin replies and UI. Actual SQLite concurrency tests + HTTP isolation/disabled/replies. |
| P1 | Source change-password input mismatched; owner lacked internal rotation | currentPassword compatibility, separate versioned owner credentials/sessions, revoke old new-app sessions, owner-only staff reset/disable. Staging owner old/new login and workspace tests. Original/legacy master secrets untouched. |
| P2 | 2MB image cap and no non-image chat attachments, rich text over-stripped | 10MB stream/file/header gates; own JPG/PNG/WebP; chat-only PDF/UTF8 TXT/CSV download capability with attachment/no-store/nosniff/sandbox; restricted text styles and own image paths. Unit boundary/download tests and real R2 10MB HTTP checks. |
| P2 | 10s polling and history replay delayed notifications | Foreground 3s seller/chat polling with baseline cursor and up to500 change rows, chat read/no-overlap/abort controls. Original event names adapted without changing generated UI bytes. This is polling, NOT WebSocket/push. |
| P2 | Original manual/support/admin-reply paths had no standalone working counterpart | Own help guide and owner-scoped inquiry inbox; source manual button routes to own guide. No external helpdesk transmission. |

## Explicit independent policy / remaining boundaries

- Earn points only once when completed AND paid; floor((gross products − used points) × rate/100). Original private server posting/rounding is not recoverable from retained frontend; this policy is deliberate, not a claimed recovered algorithm.
- AMT3 preserves threshold-to-fee pairing, sorts positive thresholds, applies the containing tier and makes at/above max free. Region rules use normalized longest keyword match (comma alternatives supported); original private matching is unknown.
- Points orders cannot be merged or line-edited: cancel and re-order so ledger/stock cannot diverge. Paid orders cannot change amount. Merge is same date/customer/address/delivery and unpaid only.
- Public customer history is bounded100, active form shortcuts50; standard order/export reads bounded5000 after filters, catalog/import2000, customer reports use explicit pages. These are safety limits, not unlimited capacity. Narrow dates/search when exporting larger histories.
- PDF checks are header/EOF/extension checks, images structural/dimension checks, not antivirus or full document/image decoding. HTML/SVG/executables/archives and non-UTF8 text remain rejected for safety. Capability URLs grant access to anyone holding the URL; customer/order/chat/driver/file links must be privately shared.
- SMS/Kakao/bank/tax/card/geocoding/external push and SMS-based signup/recovery remain deferred. Physical Android APK, Bluetooth/thermal printer, every original customer screen and private-server semantics are NOT verified as equivalent.
- Same-day behavior is opt-in via the source link setting. Retained source UI explicitly says one shipping fee for same-day repeat orders; migration0013 enforces that atomically for the same form/day/customer/address/delivery/pickup when a non-cancelled fee-bearing order already exists. Prepay ledger debits read the final stored payable after the trigger, not an outdated quote. No automatic retroactive re-billing occurs after cancellation. Migration0012 separately groups compatible pending/unpaid no-point/no-prepay/no-gift orders; explicit seller merge remains available. These safety boundaries are independent policies, not recovered private-server implementation.
- Manual discount is canonical signed adjustment; source damt projects point_used−adjustment. It cannot be below used points or above gross products, and cannot change paid/merged bill amounts. Receipt-request data is separate from issued status: unconfigured providers never set iscashreceipt=Y.
- Source transport vocabulary maps 배달/픽업(방문)/택배 and 계좌이체/현금/선결제 without changing canonical persisted/API values. Mandatory fee arrays/default discount fields prevent source modal crashes/NaN. Source editor revisions are attached by the transport, including after line saves.
- Source modules are served under a release-version directory with identical pinned application bytes; relative runtime/helper imports cannot reuse previous cached releases. The independent tools sit below source modal z600 controls, so save footers are not covered.
- Request-scoped catalog/link snapshots are reused under D1 price/form/stock guards, avoiding redundant reads without shared mutable inventory caches.
- Repeated staging bursts exposed `D1 DB is overloaded. Too many resources consumed within a 10 second window`; a single successful burst is not capacity proof. Cart lines now use one `INSERT ... SELECT json_each` (stock triggers still apply per line), and `order:new` plus returned order ID are inside the same atomic batch. There is no post-commit database operation that can turn a successfully committed new order into a reported failure. Transient D1 overload maps to503/Retry-After12, not an unexplained500. Only the exact public order-submit endpoint retries at most twice, with12–19s jittered delays and the same required durable idempotency key. Chat, uploads and arbitrary seller/financial mutations are never automatically replayed. This handles bounded transient contention, not unlimited throughput; persistent overload still returns503 safely. See [Cloudflare D1 guidance](https://developers.cloudflare.com/d1/observability/debug-d1/).
- Zero-payable prepaid orders do not insert a zero ledger row after an atomic same-day shipping waiver. Regression covers three simultaneous full-product-point prepaid orders and exact cancellation refunds.
- Frozen source grid `tamt` is deliberately projected as net payable plus reserved points because that grid subtracts its point column itself. Canonical API/DB totals remain net, preventing double subtraction without modifying generated source bytes.
- Existing orange generated application bytes and legacy routes preserved; new customer screens are source-informed compatible pages, not a claim of pixel-identical inaccessible original public screens.
