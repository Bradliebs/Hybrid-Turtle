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