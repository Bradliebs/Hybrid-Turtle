# Lessons Learned

## 2026-02-23 — Dual T212 Account Audit

### Pattern: API route / cron parity drift
When the same workflow exists in two places (API route + cron script), changes to one are easily missed in the other. The nightly API route had 4 parity bugs vs the cron version:
- R-based stops generated but never applied (most critical)
- FX normalization not wrapped in try-catch
- Portfolio value using raw entry prices instead of GBP-normalized
- P&L calculated in mixed currencies
- Missing trigger-met candidate detection
**Rule:** After editing nightly.ts, always diff against api/nightly/route.ts (and vice versa).

### Pattern: T212 sync overwriting entryPrice corrupts R-multiples
The sync was overwriting `entryPrice` with T212's `averagePricePaid` on every sync while leaving `initialRisk`, `initial_R`, `entry_price`, and `initial_stop` unchanged. After partial sells or pyramid adds, R-multiple calculations were wrong.
**Rule:** Never overwrite `entryPrice` on existing positions during broker sync. Only update `shares`.

### Pattern: ISA/Invest asymmetry in connect/disconnect
ISA connect didn't save `t212Environment`. ISA disconnect didn't clear `t212IsaUnrealisedPL`. Both were present in Invest but missing from ISA.
**Rule:** When adding dual-account fields, always check both code paths for completeness.

### Pattern: Risk gate validation using entry price as current price
The T212 sync risk gate check used `entryPrice` as `currentPrice`, understating risk on positions that had moved.
**Rule:** Risk gates must use live/current prices, not entry prices.

### Pattern: priceCurrency not propagated through data mapping layers
The cross-ref API returned `priceCurrency` (GBX, USD, EUR) per ticker, but the Plan page's `CrossRefTicker` interface didn't include the field and the mapping code didn't pass it through. `formatPrice()` defaults to GBP, so all prices showed `£` regardless of actual currency.
**Rule:** When adding a display field to an API response, grep for every consumer page and verify the field is:
1. In the TypeScript interface
2. Mapped in the data transformation
3. Passed as a prop to the rendering component

### Pattern: Yahoo chart API period2 is exclusive — scan showed yesterday's price
`getDailyPrices` set `period2` to today's date. Yahoo Finance chart API treats `period2` as **exclusive** (returns data where date < period2), so today's completed bar was never included. The scan showed Friday's close (266.10) instead of Monday's actual close (263.76). Fixed by setting `period2` to tomorrow (+1 day).
**Rule:** Yahoo chart API `period2` is exclusive. Always set it to at least tomorrow's date to capture the latest available bar.

## 2026-02-23 — Full System Audit

### Pattern: Unvalidated request.json() on mutation routes
The settings PUT route destructured `equity` directly from `await request.json()` with no Zod validation, while every other mutation route used `parseJsonBody()` or a Zod schema. A malformed equity value could flow into position sizing.
**Rule:** Every API mutation route must validate its body with Zod. After adding a new PUT/POST/DELETE route, grep for `request.json()` without a corresponding `.safeParse()` — that's the smell.

### Pattern: Grouped try-catch kills downstream modules
The nightly API route wrapped modules 7 (Swap), 11 (Whipsaw), 10 (Breadth), and 13 (Momentum) in a single try-catch. A swap failure killed breadth and momentum checks. The cron version had each in its own try-catch.
**Rule:** Each risk module in the nightly pipeline must have its own isolated try-catch. One module failure must never cascade to kill subsequent modules.

## 2026-02-24 — T212 Rate Limit on Bulk Stop Application

### Pattern: Per-ticker API calls in a loop hitting rate limits
`StopUpdateQueue.applyAll()` called `apply()` for each ticker sequentially, and each `apply()` called `POST /api/stops/t212` which internally calls `getPendingOrders()` (1 req/5s rate limit). With 20 tickers = 20 back-to-back `getPendingOrders()` calls = guaranteed 429 errors.
**Fix:** Split `applyAll()` into two phases: (1) apply all DB stops (fast, no external API), then (2) ONE bulk `PUT /api/stops/t212` call which uses `setStopLossBatch()` — fetches pending orders only once, then processes with proper delays.
**Rule:** When multiple positions need T212 API interaction, always use the batch endpoint (`PUT /api/stops/t212` → `setStopLossBatch()`) instead of individual `POST` calls. The batch method fetches `getPendingOrders()` once and spaces operations with proper delays.

### Pattern: cancelOrder() missing 429 retry logic
`cancelOrder()` used raw `fetch()` without the 429 retry logic that the `request()` helper provided. During bulk operations, cancel calls would fail immediately on rate limit instead of retrying.
**Rule:** Every T212 API method that makes HTTP calls must include 429 retry logic, not just the `request()` helper. If a method uses raw `fetch()`, it needs its own retry loop.

## 2026-02-24 — Stale Stop-Loss Recommendations (O at £64.24 vs £64.39)

### Pattern: Missing `force-dynamic` on API routes serving live DB data
16 API routes (including all 3 stops routes, positions, settings, scan) were missing `export const dynamic = 'force-dynamic'`. Next.js App Router can cache GET responses, serving stale stop values even after the DB was updated. 11 other routes that happened to be added later already had it. This was an inconsistency, not intentional.
**Rule:** Every API route file that reads from the DB MUST have `export const dynamic = 'force-dynamic'` at the top. After creating any new route, check for this directive BEFORE committing.

### Pattern: Sibling components on same page not refreshing after DB mutations
StopUpdateQueue and PositionsTable are both on `/portfolio/positions`. When the stop modal opens, it calls `GET /api/stops/t212` which syncs the DB stop UP (64.24→64.39). But StopUpdateQueue only fetches on mount — it didn't know the DB changed. Result: stale "Current Stop" in the recommendation card.
**Fix:** Added `refreshTrigger` prop to StopUpdateQueue. The parent page increments it after `handleUpdateStop()` or `handleSyncComplete()`, causing StopUpdateQueue to re-fetch fresh recommendations.
**Rule:** When two components on the same page both depend on the same DB state, add a refresh coordination mechanism. If one component triggers a DB mutation, all sibling consumers must be notified to re-fetch.