# HybridTurtle — Improvement Implementation Prompts

> Work through sequentially. Each prompt is self-contained for pasting into VSCode.

---

## Prompt 1: Yahoo Finance Retry with Exponential Backoff

**Goal:** Add retry logic to `market-data.ts` so transient Yahoo failures don't silently propagate stale data through the scan, scoring, and nightly pipelines.

**Context:**
- `src/lib/market-data.ts` is the Yahoo Finance wrapper used by the scan engine, dual score system, nightly pipeline, and live price fetches.
- Currently, a single failed Yahoo call returns an error or stale cached data with no retry attempt.
- This is the sole data source — there is no paid fallback — so making it robust matters more than usual.

**Requirements:**
1. Create a `fetchWithRetry()` utility (can live in `market-data.ts` or a new `src/lib/fetch-retry.ts`) that wraps `fetch` calls with:
   - Max 3 attempts
   - Exponential backoff: 1s → 2s → 4s
   - Retry only on transient errors: network timeouts, HTTP 429 (rate limit), 5xx server errors
   - Do NOT retry on 4xx client errors (except 429) — those indicate bad requests
   - Log each retry attempt with `console.warn` including the ticker, attempt number, and error
2. Apply `fetchWithRetry()` to all Yahoo Finance fetch calls in `market-data.ts` — prices, quotes, historical bars, batch calls.
3. If all retries fail, the function should still return the existing error/fallback behaviour (don't change the interface contract).
4. Add a `YAHOO_RETRY_ENABLED` constant at the top of the file (default `true`) so it can be toggled off quickly if it causes issues.

**Do NOT modify:** `stop-manager.ts`, `risk-gates.ts`, `scan-engine.ts`, `dual-score.ts`, `regime-detector.ts`, `position-sizer.ts` (sacred files).

**Test:** Add a Vitest test in `market-data.test.ts` that mocks a fetch returning 503 twice then 200, confirming retry succeeds and returns valid data.

---

## Prompt 2: Staleness Detection on Market Data

**Goal:** Make it obvious when Yahoo data is stale so the scan and dashboard don't silently operate on outdated prices.

**Context:**
- `market-data.ts` has a 30-minute in-memory quote cache.
- There is no mechanism to flag when cached data is being served because a live fetch failed, vs fresh data from a successful fetch.
- The dashboard has a `DataSourceTile` component that could display staleness.
- The nightly Telegram summary should warn if data was stale during the run.

**Requirements:**
1. In `market-data.ts`, track metadata alongside cached data:
   - `lastFetchTimestamp: number` — when the data was actually fetched from Yahoo
   - `source: 'LIVE' | 'CACHE' | 'STALE_CACHE'` — LIVE means fresh fetch succeeded, CACHE means within TTL, STALE_CACHE means fetch failed and serving expired cache
   - Export a `getDataFreshness()` function returning `{ source, ageMinutes, lastFetchTime }` for the most recent batch of fetches.
2. In the nightly pipeline (`src/cron/nightly.ts`), after step 2 (fetch live prices), check `getDataFreshness()`. If `source === 'STALE_CACHE'` or `ageMinutes > 60`, add a warning line to the Telegram summary: `"⚠️ Market data is ${ageMinutes}m old (source: ${source})"`.
3. In the `/api/data-source` route, include the freshness metadata in the response so the dashboard `DataSourceTile` can display it.
4. On the dashboard, if data source is STALE_CACHE, the `DataSourceTile` should show an amber indicator instead of green.

**Do NOT modify sacred files.**

---

## Prompt 3: Force Fresh Fetch on Tuesday Execution Day

**Goal:** Ensure that on EXECUTION phase (Tuesday), the buy flow always uses live prices, never cached.

**Context:**
- Weekly phase: Tuesday = EXECUTION. This is the only day new positions are opened.
- The `BuyConfirmationModal` triggers `/api/positions/execute` which runs the 4-phase T212 execution.
- Current 30-minute cache TTL means a quiet Tuesday morning could serve stale prices to the position sizer and risk gates.
- The `WeeklyPhaseIndicator` already tracks the current phase.

**Requirements:**
1. In the `/api/positions/execute` route, before phase 1 (market buy), force a fresh Yahoo fetch for the target ticker by bypassing the cache. Add a `forceRefresh: boolean` parameter to the relevant `market-data.ts` fetch function that skips the cache check.
2. Also force-refresh in `/api/positions` POST (position creation with risk gate enforcement) — the risk gates need current prices too.
3. In `/api/scan/live-prices` POST, if the current day is Tuesday (check server-side, not client), bypass the cache for all requested tickers.
4. Do NOT change the default cache behaviour for non-execution paths — the 30-minute TTL is fine for dashboard display and maintenance days.

**Do NOT modify sacred files.**

**Test:** Add a test confirming that when `forceRefresh: true` is passed, the cache is bypassed and a new fetch is made even if cached data exists within TTL.

---

## Prompt 4: Nightly Watchdog — Missed Heartbeat Alert

**Goal:** Detect when the nightly pipeline fails to run at all (Task Scheduler silent failure, machine asleep, etc.) and send a Telegram alert.

**Context:**
- The nightly runs via `nightly-task.bat` → Windows Task Scheduler.
- On success or failure, it writes a heartbeat to the `Heartbeat` DB table.
- If Task Scheduler doesn't fire, no heartbeat is written and nothing alerts.
- There's a `midday-sync-task.bat` that also runs via Task Scheduler.
- Telegram sending is in `src/lib/telegram.ts`.

**Requirements:**
1. Create a new script: `src/cron/watchdog.ts` — a lightweight check that:
   - Queries the `Heartbeat` table for the most recent nightly heartbeat
   - If the most recent heartbeat is older than 26 hours, sends a Telegram alert: `"🚨 WATCHDOG: No nightly heartbeat in 26+ hours. Last run: ${lastRunTime}. Check Task Scheduler."`
   - If the heartbeat exists and is within 26 hours, exits silently (no output, no DB write)
2. Create `watchdog-task.bat` that runs: `npx tsx src/cron/watchdog.ts`
3. Create `register-watchdog-task.bat` that registers a Windows Scheduled Task to run `watchdog-task.bat` at 10:00 AM daily (the nightly typically runs overnight, so a 10 AM check gives plenty of margin).
4. The watchdog should also check the midday sync heartbeat — if it's a weekday and no midday heartbeat exists for today AND no SKIPPED heartbeat exists, include that in the alert too.

**Do NOT modify the existing nightly or midday-sync scripts.**

---

## Prompt 5: Partial Nightly Heartbeat Status

**Goal:** Replace the binary SUCCESS/FAILED heartbeat with a PARTIAL status that records which steps degraded.

**Context:**
- `src/cron/nightly.ts` runs a 9-step pipeline (steps 0–9).
- Each step wraps in try/catch. Failures set `hadFailure = true` and continue.
- The final heartbeat writes SUCCESS or FAILED based on `hadFailure`.
- The `Heartbeat` table has columns: `status`, `error`, `createdAt`.
- The dashboard `HeartbeatMonitor` component displays the latest heartbeat.

**Requirements:**
1. In `nightly.ts`, track step-level results:
   - Create a `stepResults: Array<{ step: number, name: string, status: 'OK' | 'FAILED' | 'SKIPPED', error?: string, durationMs: number }>` array.
   - Wrap each step with timing (`Date.now()` before/after) and record the result.
2. At the end of the pipeline:
   - If all steps OK → heartbeat status = `SUCCESS`
   - If some steps failed but pipeline completed → heartbeat status = `PARTIAL`
   - If a critical failure prevents continuation → heartbeat status = `FAILED`
   - Store the `stepResults` array as JSON in the heartbeat `error` field (rename conceptually to `details` if schema change is acceptable, otherwise reuse `error` field).
3. In the Telegram summary (step 8), if any steps failed, include a section: `"⚠️ Degraded steps: Step 2 (live prices) - timeout after 3 retries"`.
4. In the `HeartbeatMonitor` dashboard component, show:
   - SUCCESS → green
   - PARTIAL → amber, with tooltip showing which steps failed
   - FAILED → red

**Schema change:** If needed, add a `details` TEXT column to the `Heartbeat` table via a new Prisma migration. Keep the existing `error` column for backward compatibility.

---

## Prompt 6: Equity Growth Advisory

**Goal:** Surface a prompt when account equity crosses thresholds where a risk profile review makes sense.

**Context:**
- Currently on SMALL_ACCOUNT profile (2% risk, 4 max positions, 10% max open risk) with ~£429.
- Risk profiles are defined in `src/types/index.ts`.
- Equity is stored in the `User` table and updated manually via `/settings`.
- `EquitySnapshot` table tracks periodic equity recordings.
- The dashboard has multiple widget slots and the Telegram summary has a flexible format.

**Requirements:**
1. Define equity review thresholds in `src/types/index.ts` alongside the risk profiles:
   ```
   EQUITY_REVIEW_THRESHOLDS = [
     { equity: 1000, message: "Account passed £1,000 — consider whether SMALL_ACCOUNT 4-position limit is still optimal" },
     { equity: 2000, message: "Account passed £2,000 — BALANCED profile (5 positions, 0.95% risk) may now be appropriate" },
     { equity: 5000, message: "Account passed £5,000 — review all profile options for better diversification" },
   ]
   ```
2. In the nightly pipeline, after the equity snapshot step (step 6), check current equity against thresholds. If a threshold has been crossed AND the user hasn't dismissed it before:
   - Add a line to the Telegram summary: the threshold message
   - Create an in-app notification via `alert-service.ts` with type `EQUITY_MILESTONE` and priority `LOW`
3. Track dismissed thresholds: add a `dismissedEquityThresholds` JSON field to the `User` table (array of equity values already acknowledged). The notification should include a dismiss action.
4. On the dashboard, show this as a subtle info banner (not blocking) — similar style to the `OnboardingBanner` but for equity milestones.

**Do NOT modify sacred files. This is advisory only — it must never auto-change the risk profile.**

---

## Prompt 7: Disabled Module Cleanup

**Goal:** Properly gate disabled modules (Fast Follower, Momentum Expansion) so they can't be accidentally enabled and don't clutter the module status panel.

**Context:**
- Module 9 (Fast Follower, `src/lib/modules/fast-follower.ts`) — currently disabled.
- Module 13 (Momentum Expansion, `src/lib/modules/momentum-expansion.ts`) — currently disabled.
- The `/api/modules` route runs all 21 module checks and returns results.
- The dashboard `ModuleStatusPanel` displays all module statuses.
- These modules are disabled for a reason (likely underperformance or unsuitability for small account) but the reason isn't documented.

**Requirements:**
1. In each disabled module file, add a header comment block documenting:
   - Why it was disabled (add a placeholder if the reason isn't clear: `// DISABLED: [reason TBD — do not enable without review]`)
   - What conditions would justify re-enabling (e.g., "Re-enable when account supports 6+ positions and regime is BULLISH for 4+ consecutive weeks")
   - Date disabled
2. Add a `DISABLED_MODULES` constant in `src/types/index.ts`:
   ```
   DISABLED_MODULES: Set<number> = new Set([9, 13])
   ```
3. In `/api/modules`, skip disabled modules entirely — don't run their checks. Return them in the response with status `DISABLED` so the UI knows they exist but aren't active.
4. In the `ModuleStatusPanel`, show disabled modules in a collapsed "Disabled" section with grey styling, separate from active modules. Include the reason comment if available.
5. If someone tries to reference a disabled module in any risk-affecting path (scan engine, risk gates, position creation), it should be a no-op with a console.warn, not an error.

**Do NOT modify sacred files.**

---

## Prompt 8: Slippage Feedback into Anti-Chase Guard

**Goal:** Use historical slippage data to dynamically adjust the anti-chase guard thresholds.

**Context:**
- `src/lib/scan-guards.ts` implements the anti-chase guard: blocks entry if gap > 0.75 ATR or > 3% above trigger.
- `TradeLog` table stores slippage data per trade (planned vs actual entry price).
- `/api/ev-stats` provides expected value statistics.
- The anti-chase thresholds are currently hardcoded constants.

**Requirements:**
1. Create a function `getSlippageStats()` in a new file `src/lib/slippage-tracker.ts` that:
   - Queries the `TradeLog` for the last 20 completed trades (or all trades if fewer than 20)
   - Calculates: `avgSlippagePct`, `medianSlippagePct`, `maxSlippagePct`, `slippageDirection` (consistently positive = buying above planned entry)
   - Returns the stats object
2. In `scan-guards.ts`, add an optional `slippageBuffer` parameter to the anti-chase check:
   - If `avgSlippagePct > 0.15%` (consistently overshooting entries), tighten the ATR gap threshold from 0.75 to `0.75 - (avgSlippagePct / 100)` (minimum floor of 0.5 ATR)
   - This is a soft adjustment — the hard floor prevents over-tightening
   - Log when the adjustment is active: `console.info('Anti-chase guard tightened by slippage buffer: ${adjustment}')`
3. In the `/api/scan` route, fetch slippage stats and pass the buffer to the scan engine's anti-chase stage.
4. On the `/scan` page, if the slippage buffer is active, show a small info badge on the anti-chase stage in the `StageFunnel`: "Tightened by historical slippage".
5. Add slippage trend to the `/trade-log` page summary stats section: "Avg slippage: X% (last 20 trades)".

**Caution:** `scan-guards.ts` is not a sacred file, but it directly affects which trades pass. Test thoroughly.

**Test:** Vitest test with mocked TradeLog data showing 0.3% average slippage, confirming the ATR threshold adjusts from 0.75 to ~0.72 ATR.

---

## Prompt 9: Stop Route Consolidation

**Goal:** Merge the four stop-related route files into a single route group with method/action dispatch.

**Context:**
- Current stop routes spread across:
  - `/api/stops` (GET / PUT) — recommendations and updates
  - `/api/stops/apply` (POST) — apply recommendations to T212
  - `/api/stops/sync` (GET / POST / PUT) — sync stops from CSV / T212
  - `/api/stops/t212` (GET / POST / DELETE / PUT) — direct T212 stop management
- All four interact with the same data: stops, T212 API, positions.
- This is a single-user system — the REST purity of separate routes adds complexity without benefit.

**Requirements:**
1. Create a new unified route structure:
   ```
   /api/stops/route.ts          — GET (list recommendations), PUT (update stop)
   /api/stops/apply/route.ts    — POST (apply to T212) — keep separate, it's a distinct action
   /api/stops/sync/route.ts     — GET/POST/PUT (all sync operations)
   /api/stops/t212/route.ts     — GET/POST/DELETE/PUT (direct T212 management)
   ```
   Actually — the current structure is already this. The real consolidation opportunity is:
   - Merge `/api/stops/t212` INTO `/api/stops` with an `action` query parameter or request body field
   - Merge `/api/stops/sync` INTO `/api/stops` with appropriate action dispatch
   - Keep `/api/stops/apply` as-is (it's the dangerous one that touches the broker)
   - Result: 2 route files instead of 4

2. Update all client-side fetch calls that reference the old routes.
3. Add deprecation comments to any old route files that are kept temporarily for backward compatibility.
4. Ensure the `ExecutionLog` still records all T212 API calls correctly after consolidation.

**Do NOT modify sacred files. Do NOT change any stop calculation logic — this is purely a routing refactor.**

**Test:** Manually verify via the UI that stop recommendations display, sync works, and apply-to-T212 functions correctly after the refactor.

---

## Prompt 10: Secrets to Environment Variables

**Goal:** Move T212 API keys and Telegram bot credentials out of the SQLite database and into environment variables.

**Context:**
- T212 API keys (Invest + ISA) and Telegram bot token + chat ID are stored in the `User` table in `dev.db`.
- `package-for-distribution.bat` packages the app for another machine — if `dev.db` is included, credentials leak.
- The friend who runs this system independently needs their own credentials.
- Settings page (`/settings`) currently reads/writes these from the DB.

**Requirements:**
1. Define new environment variables in `.env.local` (gitignored):
   ```
   T212_INVEST_API_KEY=
   T212_ISA_API_KEY=
   T212_INVEST_ACCOUNT_ID=
   T212_ISA_ACCOUNT_ID=
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_CHAT_ID=
   ```
2. Create a `src/lib/secrets.ts` module that:
   - First checks environment variables
   - Falls back to the `User` table if env vars are not set (backward compatibility)
   - Exports `getT212Credentials(accountType: 'ISA' | 'INVEST')` and `getTelegramCredentials()`
   - Logs which source was used on first access: `console.info('T212 credentials loaded from: ENV')`
3. Update all consumers of T212 credentials (`trading212.ts`, `trading212-dual.ts`, `position-sync.ts`) to use `secrets.ts` instead of direct DB reads.
4. Update `telegram.ts` to use `secrets.ts`.
5. On the `/settings` page:
   - If credentials are loaded from ENV, show the fields as read-only with a message: "Managed via environment variables"
   - If loaded from DB, keep current editable behaviour
6. Update `package-for-distribution.bat` to:
   - Copy `.env.example` (with empty values) instead of `.env.local`
   - Exclude `dev.db` or at minimum strip the credential columns before packaging
7. Add `.env.example` to the project root with all keys listed but empty.

**Do NOT modify sacred files.**

---

*Generated: 4 March 2026*
