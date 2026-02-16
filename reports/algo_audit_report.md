# Quant Algorithm Audit Report

Date: 2026-02-16  
Scope: readiness/state classification, stops, sizing/risk, performance, re-entry logic

---

## 1) INVENTORY

### 1.1 Target modules (outputs, inputs, writes)

| Module | What it computes (outputs) | What it reads (inputs) | What it writes |
|---|---|---|---|
| `src/lib/stop-manager.ts` | Protection levels, recommended stop upgrades, trailing ATR stop recommendations | Current price, entry, initial risk, current stop, ATR, historical bars | Writes `StopHistory`; updates `Position.currentStop`, `Position.stopLoss`, `Position.protectionLevel` via `updateStopLoss` |
| `src/lib/stop-manager.test.ts` | Verifies thresholds/formulas/monotonic behavior | Synthetic fixtures + mocked market bars | Test-only |
| `prisma/sync-stops.ts` | CSV stop sync decisions, protection-level derivation on import | `Planning/positions_state.csv`, open positions, ticker matching rules | Writes `StopHistory`; updates `Position` (only when new stop is higher) |
| `src/lib/risk-gates.ts` | Gate pass/fail set, risk budget utilization, pyramid eligibility | Candidate position, existing positions, equity, risk profile caps | Pure compute (no DB/API writes) |
| `src/lib/risk-gates.test.ts` | Verifies gate formulas, denominator behavior, pyramid triggers | Synthetic fixtures | Test-only |
| `src/lib/regime-detector.ts` | `detectRegime`, `checkRegimeStability`, `detectDualRegime` outputs | SPY/VWRL + MA + DI/ADX + VIX + A/D inputs | Pure compute (no writes); marked deprecated for production trade gates |
| `src/lib/position-sizer.ts` | Shares, cost, risk cash, risk %, R-per-share | Equity, risk profile, entry/stop, optional sleeve, optional FX rate | Pure compute |
| `src/lib/scan-engine.ts` | Filters, candidate status, distance %, rank, sizing outputs, risk-gate and anti-chase flags | Technical data, regime, FX, risk profile, open positions | Returns scan payload; persisted in scan API route |
| `src/lib/scan-guards.ts` | Monday anti-chase decision and pullback-continuation trigger | Price, trigger, ATR, day-of-week, HH20/EMA20/low/close | Pure compute |
| `src/cron/nightly.ts` | Nightly workflow outputs: stop updates, risk snapshots, module alerts, READY/trigger lists | DB positions/user, live prices/bars, stop manager, risk modules, snapshot sync | Writes stop updates, heartbeat, equity snapshot, notifications |
| `prisma/schema.prisma` | Persistence contracts for position/stop/scan/risk metrics | N/A | Defines DB source-of-truth fields |
| `src/app/api/positions/route.ts` | Position payload incl. `rMultiple`, `gainPercent`, GBP fields (`initialRiskGBP`) | Positions, live prices, FX normalization, risk helpers | API response only |
| `src/app/api/risk/route.ts` | Risk summary, budget, open-risk fields, risk efficiency | User/profile, open positions, prices/FX, risk budget/equity snapshot funcs | API response + writes equity snapshot |
| `src/app/risk/page.tsx` + `src/components/risk/*` | Risk dashboard rendering from API | `/api/risk` payload | UI state only |

Evidence pointers (current):
- `src/lib/stop-manager.ts:getProtectionLevel:19`, `calculateStopRecommendation:63`, `calculateTrailingATRStop:233`, `updateStopLoss:101`
- `prisma/sync-stops.ts:syncStops:16`
- `src/lib/risk-gates.ts:validateRiskGates:28`, `getRiskBudget:237`, `canPyramid:167`
- `src/lib/regime-detector.ts:detectRegime:28`, `checkRegimeStability:119`, `detectDualRegime:148`
- `src/lib/position-sizer.ts:calculatePositionSize:20`
- `src/lib/scan-engine.ts:runTechnicalFilters:38`, `classifyCandidate:73`, `runFullScan:115`
- `src/lib/scan-guards.ts:checkAntiChasingGuard:11`, `checkPullbackContinuationEntry:75`
- `src/cron/nightly.ts:runNightlyProcess:40`
- `src/app/api/positions/route.ts:GET:35`, `src/app/api/risk/route.ts:GET:14`
- `prisma/schema.prisma:model Position:56`, `StopHistory:91`, `ScanResult:115`, `EquitySnapshot:250`

### 1.2 Data flow (implemented)

- `scan-engine.runFullScan` runs universe + technical fetch + filter/status/ranking (`src/lib/scan-engine.ts:115-447`)
- `scan-guards` applies anti-chase and pullback continuation conditions (`src/lib/scan-engine.ts:296-351`, `src/lib/scan-guards.ts:11-131`)
- `risk-gates.validateRiskGates` computes gate set from sizing/open positions (`src/lib/scan-engine.ts:269-293`, `src/lib/risk-gates.ts:28-141`)
- `stop-manager` computes + persists stop upgrades and trailing stops (`src/cron/nightly.ts:88-152`, `src/lib/stop-manager.ts:63-341`)
- `position-sizer.calculatePositionSize` provides shares/risk for candidates (`src/lib/scan-engine.ts:246-267`, `src/lib/position-sizer.ts:20-95`)
- DB sync path updates stops from CSV (`prisma/sync-stops.ts:16-165`)
- API layer serves positions/risk summaries (`src/app/api/positions/route.ts:35+`, `src/app/api/risk/route.ts:14+`)
- UI reads APIs and displays risk state (`src/app/risk/page.tsx:50-65,121-143`)

### 1.3 Source-of-truth map + duplicate calculations

- READY/WATCH/FAR/WAIT_PULLBACK: `scan-engine` status + override path (`classifyCandidate` + extATR override) (`src/lib/scan-engine.ts:73-81`, `296-314`)
- Stop level in storage: `Position.currentStop` + `StopHistory` (`prisma/schema.prisma:64,91`), mutated by `updateStopLoss` and `sync-stops`
- ATR values:
  - core ATR utility in `market-data.calculateATR` (`src/lib/market-data.ts:253-269`)
  - separate rolling ATR loop in `stop-manager.calculateTrailingATRStop` (`src/lib/stop-manager.ts:264-285`)
- Risk-per-trade constants: `RISK_PROFILES[*].riskPerTrade` (`src/types/index.ts:22-51`)
- Open-risk formula source in risk workflows: `max(0, (currentPrice - currentStop)*shares)` with GBP-normalization where applicable (`src/lib/risk-gates.ts:46-52`, `src/lib/risk-fields.ts:14-20`, `src/app/api/risk/route.ts:60-84`)
- Re-entry behavior in audited scope: pullback continuation (`scan-guards`) + pyramiding add checks (`risk-gates.canPyramid`); no separate “post-stop re-entry engine” module found in listed targets

---

## 2) RULES EXTRACT (AS CODED)

### 2A) Readiness / state classification

#### `risk-gates.ts` (`validateRiskGates`)

1. **Total Open Risk gate**
   - `currentOpenRisk = Σ max(0, riskDollars ?? (currentPrice-currentStop)*shares)` excluding `sleeve==='HEDGE'`
   - `totalOpenRiskPercent = ((currentOpenRisk + newPosition.riskDollars) / equity) * 100`
   - pass if `totalOpenRiskPercent <= profile.maxOpenRisk`
   - Evidence: `src/lib/risk-gates.ts:44-62`

2. **Max Positions gate**
   - `openPositions = nonHedgePositions.length`
   - pass if `openPositions < profile.maxPositions`
   - Evidence: `src/lib/risk-gates.ts:65-74`

3. **Sleeve/cluster/sector/position-size denominators**
   - `totalInvestedValue = Σ existing.value + newPosition.value`
   - `denom = Math.max(equity, totalInvestedValue)`
   - Evidence: `src/lib/risk-gates.ts:77-79`

4. **Sleeve limit**
   - `sleevePercent = sleeveValue / denom`
   - pass if `sleevePercent <= SLEEVE_CAPS[newPosition.sleeve]`
   - Evidence: `src/lib/risk-gates.ts:80-90`

5. **Cluster concentration** (if cluster present)
   - `clusterPercent = clusterValue / denom`
   - pass if `clusterPercent <= caps.clusterCap`
   - Evidence: `src/lib/risk-gates.ts:93-104`

6. **Sector concentration** (if sector present)
   - `sectorPercent = sectorValue / denom`
   - pass if `sectorPercent <= caps.sectorCap`
   - Evidence: `src/lib/risk-gates.ts:108-119`

7. **Position size cap**
   - `positionSizeCap = caps.positionSizeCaps[sleeve] ?? POSITION_SIZE_CAPS.CORE`
   - `positionSizePercent = newPosition.value / denom`
   - pass if `positionSizePercent <= positionSizeCap`
   - Evidence: `src/lib/risk-gates.ts:123-132`

#### `scan-guards.ts` and `scan-engine.ts`

- Anti-chase guard active only when Monday (`dayOfWeek===1`) and `currentPrice>=entryTrigger`
- reject if `gapATR > 0.75`
- reject if `percentAbove > 3.0`
- Evidence: `src/lib/scan-guards.ts:16-41`

- Base status classification (`scan-engine.classifyCandidate`):
  - `distance = ((entryTrigger - price) / price) * 100`
  - `distance <= 2` => `READY`
  - `distance <= 3` => `WATCH`
  - else `FAR`
- Evidence: `src/lib/scan-engine.ts:73-81`

- Stage-6 all-day extension guard override in `runFullScan`:
  - `extATR = (price-entryTrigger)/atr`
  - if `extATR > 0.8` => set `status='WAIT_PULLBACK'`
- Evidence: `src/lib/scan-engine.ts:296-314`

DIST definitions as coded:
- `DIST_READY`: `distance <= 2` (percent)
- `DIST_WATCH`: `2 < distance <= 3` (percent)

### 2B) Regime detection

- `regime-detector.ts` is marked deprecated for production trade gating (`@deprecated`); trade gates use `market-data.getMarketRegime()`
- Evidence: `src/lib/regime-detector.ts:8,25`, `src/lib/market-data.ts:649-662`

- In deprecated `detectRegime`:
  - `CHOP_BAND_PCT = 0.02` (±2% around MA200)
  - if SPY in chop band -> force `SIDEWAYS`
  - bullish/bearish point scoring from price vs MA200, DI relation, VIX, A/D ratio
- Evidence: `src/lib/regime-detector.ts:19,38-109`

- `checkRegimeStability`:
  - stable if `consecutiveDays >= 3`
  - else display as CHOP/SIDEWAYS proxy
- Evidence: `src/lib/regime-detector.ts:131-143`

- `detectDualRegime`:
  - per benchmark regime via ±2% MA200 chop band
  - combined `BULLISH` only if both bullish; `BEARISH` if either bearish
- Evidence: `src/lib/regime-detector.ts:156-177`

- Production regime (`getMarketRegime`):
  - `BULLISH` if `spyPrice > spyMa200 && spyMa50 > spyMa200`
  - `BEARISH` if `spyPrice < spyMa200 && spyMa50 < spyMa200`
  - else `SIDEWAYS`
- Evidence: `src/lib/market-data.ts:659-661`

Candle timing:
- Technical/regime calculations use daily bars from `getDailyPrices(..., 'full'|'compact')`
- No weekly-candle regime path in audited modules
- Evidence: `src/lib/market-data.ts:286-336,649-662`

### 2C) Stops

- Protection levels by R-multiple:
  - `>=3.0` => `LOCK_1R_TRAIL`
  - `>=2.5` => `LOCK_08R`
  - `>=1.5` => `BREAKEVEN`
  - else `INITIAL`
- Evidence: `src/lib/stop-manager.ts:19-26`

- Protection stop formulas (`calculateProtectionStop`):
  - `INITIAL`: `entry - initialRisk`
  - `BREAKEVEN`: `entry`
  - `LOCK_08R`: `entry + 0.5*initialRisk`
  - `LOCK_1R_TRAIL`: `max(entry + 1.0*initialRisk, currentPrice - 2*currentATR)`
- Evidence: `src/lib/stop-manager.ts:34-56`

- Recommendation constraints (`calculateStopRecommendation`):
  - computes `rMultiple = (currentPrice-entryPrice)/initialRisk`
  - only higher protection-level upgrades (`recommendedIdx > currentIdx`)
  - monotonic recommendation guard: ignore if `newStop <= currentStop`
- Evidence: `src/lib/stop-manager.ts:74-93`

- Persisted monotonic hard-stop (`updateStopLoss`): throws if `newStop < currentStop`
- Evidence: `src/lib/stop-manager.ts:124-130`

- Trailing ATR stop (`calculateTrailingATRStop`):
  - rolling ATR uses arithmetic average of 14 true ranges in loop (SMA-style, not Wilder smoothing)
  - candidate stop: `highestClose - atrMultiplier*atr` (default `2.0`)
  - ratchet only upward (`candidateStop > trailingStop`)
  - output `trailingStop` rounded to 2 decimals
- Evidence: `src/lib/stop-manager.ts:233-306`

- CSV sync (`sync-stops.ts`):
  - apply only if `newStop > oldStop`
  - level from `rMultiple=(newStop-entryPrice)/initialRisk` and same threshold ladder
- Evidence: `prisma/sync-stops.ts:101-132`

### 2D) Sizing

- `riskPercent = customRiskPercent ?? RISK_PROFILES[riskProfile].riskPerTrade`
- `riskPerShare = (entryPrice-stopPrice) * fxToGbp`
- `riskCashRaw = equity*(riskPercent/100)` then optional `risk_cash_cap` / `risk_cash_floor`
- `shares = floor(riskCash/riskPerShare)`
- enforce sleeve position-size cap against GBP cost: `shares*entryPrice*fxToGbp <= equity*cap`
- enforce per-position max loss cap if configured: `riskPerShare*shares <= equity*(per_position_max_loss_pct/100)`
- output risk%: `(actualRiskDollars/equity)*100`
- Evidence: `src/lib/position-sizer.ts:37-89`

Key constants used:
- `ATR_STOP_MULTIPLIER = 1.5`
- `ATR_VOLATILITY_CAP_ALL = 8`
- `ATR_VOLATILITY_CAP_HIGH_RISK = 7`
- `BALANCED`: `riskPerTrade=0.95`, `maxPositions=5`, `maxOpenRisk=5.5`
- Evidence: `src/types/index.ts:30-37,74-81`

---

## 3) CONSISTENCY & INTEGRATION CHECKS

### Potential Mismatch 1 — Monday anti-chase threshold text vs coded threshold

- Risk page immutable-rule text states: “NEVER chase a Monday gap >1 ATR”.
- Actual guard code blocks at `gapATR > 0.75` (and separately `percentAbove > 3.0`).
- Evidence: `src/app/risk/page.tsx:106`, `src/lib/scan-guards.ts:29-41`

### Potential Mismatch 2 — Risk metric naming across APIs

- `/api/risk` uses open risk (`currentPrice - currentStop`) via `computeOpenRiskGBP`.
- `/api/positions` exposes `initialRiskGBP` and deprecated alias `riskGBP` from (`entryPrice - stop`).
- Same “risk” label family can be read as one concept while formulas differ by intent.
- Evidence: `src/app/api/risk/route.ts:60-84`, `src/lib/risk-fields.ts:1-20`, `src/app/api/positions/route.ts:131-156`

### Potential Mismatch 3 — Stop rounding differs by path

- Trailing ATR path rounds to 2 decimals (`Math.round(x*100)/100`).
- R-based recommendation path and CSV sync do not apply explicit rounding before persistence.
- Evidence: `src/lib/stop-manager.ts:299`, `src/lib/stop-manager.ts:84-93,143-154`, `prisma/sync-stops.ts:118-131`

### Nightly ordering check (stale-data risk)

- Nightly step order is: stop updates (step 3/3b) -> equity snapshot (step 6) -> snapshot sync/query (step 7).
- This ordering uses post-update stops before risk snapshot; no stale ordering issue observed.
- Evidence: `src/cron/nightly.ts:88-152`, `355-382`, `429-519`

No proven mismatch found in current code for previously flagged items:
- Risk-gates denominator now uses `Math.max(equity, totalInvestedValue)` (prevents empty-book 100% concentration auto-fail)
- Scan DB fallback now preserves nullable pass flags via `normalizePersistedPassFlag` (no forced `true`)
- Evidence: `src/lib/risk-gates.ts:77-79`, `src/app/api/scan/route.ts:217-220`

---

## 4) NUMERICAL VALIDATION (3 WORKED EXAMPLES)

Validation execution performed:
- `npm run test:unit -- src/lib/risk-gates.test.ts src/lib/stop-manager.test.ts src/lib/position-sizer.test.ts` => **31/31 passed**.
- Synthetic examples executed with `npx tsx -e` using:
  - `classifyCandidate`
  - `calculatePositionSize`
  - `validateRiskGates`
  - `calculateStopRecommendation`

Assumptions used in synthetic run:
- Equity = 10,000
- Profile = BALANCED (`riskPerTrade=0.95`, `maxOpenRisk=5.5`)
- ATR = 4 for entry-stop examples
- Initial stop formula from scan path: `entry - 1.5*ATR`

### Example 1 — Clearly READY

Inputs:
- `price=100`, `entry=101`, `atr=4`, no existing positions

Step-by-step:
1. Readiness distance: `((101-100)/100)*100 = 1.0%` -> `READY` (`<=2`)
2. Initial stop: `101 - 1.5*4 = 95`
3. Sizing: risk/share `=6`; risk cash `=10000*0.95%=95`; shares `=floor(95/6)=15`; risk `=90`; cost `=1515`
4. Gates:
   - open risk `% = (0+90)/10000*100 = 0.9%` -> pass (`<=5.5`)
   - sleeve/cluster/sector/position-size each `15.15%` (denom=10000) -> all pass
5. Trailing stop worked check (separate trade-state example): `calculateStopRecommendation(130,100,10,90,'INITIAL',5)` returns `newStop=120`, `newLevel=LOCK_1R_TRAIL`

### Example 2 — Clearly WATCH

Inputs:
- `price=100`, `entry=102.5`, `atr=4`, no existing positions

Step-by-step:
1. Readiness distance: `((102.5-100)/100)*100 = 2.5%` -> `WATCH` (`>2 && <=3`)
2. Initial stop: `102.5 - 6 = 96.5`
3. Sizing: shares `=15`; risk `=90`; risk% `=0.9`; cost `=1537.5`
4. Gates: all pass; sleeve/cluster/sector/position-size each `15.38%`
5. Trailing stop example remains monotonic (`newStop=120` for the dedicated +3R sample)

### Example 3 — Borderline threshold (exact boundary)

Inputs:
- `price=100`, `entry=102`, `atr=4`, no existing positions

Step-by-step:
1. Readiness distance: `((102-100)/100)*100 = 2.0%`
2. Because comparison is `<=2`, status => `READY` (borderline)
3. Initial stop: `102 - 6 = 96`
4. Sizing: shares `=15`; risk `=90`; risk% `=0.9`; cost `=1530`
5. Gates: all pass; sleeve/cluster/sector/position-size each `15.30%`

API/UI confirmation for these values (code-path evidence):
- Status and distance are surfaced from scan candidate payload and displayed directly in scan UI cards/table.
  - Evidence: `src/app/api/scan/route.ts:167-176,241-249`, `src/app/scan/page.tsx:354-361`
- Risk dashboard uses `/api/risk` fields directly; open-risk is sourced from `computeOpenRiskGBP` formula.
  - Evidence: `src/app/api/risk/route.ts:60-84,111-120`, `src/app/risk/page.tsx:53-65,125-142`

---

## 5) FINDINGS TABLE (PROVABLE ONLY)

| Severity (P0–P3) | Area | Finding | Evidence (file:function:line) | Impact | Minimal Fix | Validation Steps |
|---|---|---|---|---|---|---|
| P2 | UI vs execution guard | Risk page immutable rule says Monday chase block is `>1 ATR`, but actual guard blocks at `>0.75 ATR` (also `>3%` above trigger). | `src/app/risk/page.tsx:RiskPage:106`; `src/lib/scan-guards.ts:checkAntiChasingGuard:29-41` | User-facing threshold can mislead manual trade decisions and post-trade reviews. | Update risk-page banner text to match coded thresholds (`>0.75 ATR` and `>3%`). | Visual check risk page text + unit test unchanged; optionally add UI copy snapshot/assertion if present. |
| P2 | Reporting semantics | “Risk” fields differ by endpoint intent: `/api/risk` = open risk; `/api/positions` = initial risk (`initialRiskGBP`, deprecated `riskGBP`). | `src/app/api/risk/route.ts:GET:60-84`; `src/app/api/positions/route.ts:GET:131-156`; `src/lib/risk-fields.ts:1-20` | Can cause cross-screen comparison confusion if users treat both as the same risk metric. | Clarify labels/tooltips (e.g., “Initial Risk GBP” vs “Open Risk GBP”) without changing formulas. | Compare both endpoints for same position and confirm labels communicate formula differences. |
| P3 | Module ownership clarity | `regime-detector.ts` still present but marked deprecated while production gate uses `getMarketRegime()`. | `src/lib/regime-detector.ts:8,25`; `src/lib/market-data.ts:getMarketRegime:649-662` | Maintenance ambiguity only; not a confirmed trading-logic defect. | Add explicit doc note in audit/docs naming canonical regime source. | Documentation check only. |

No P0/P1 issue is proven in current target-module state from this audit.

### Post-audit updates (2026-02-16)

- Implemented: anti-chase banner copy now matches coded guard thresholds (`>0.75 ATR` and `>3%`).
  - Evidence: `src/app/risk/page.tsx:106`; guard logic `src/lib/scan-guards.ts:29-41`.
- Implemented: `/api/risk` now exposes explicit `openRiskDollars` alias (same formula/value as `openRiskGBP`) while keeping `riskDollars` for compatibility.
  - Evidence: `src/app/api/risk/route.ts:86-91`; test `src/app/api/risk/route.test.ts:57-92`.
- Validation run (post-change):
  - `npm run test:unit -- src/app/api/risk/route.test.ts src/app/api/positions/route.test.ts` (2/2 passing).

---

## 6) MINIMAL FIX PLAN + VALIDATION CHECKLIST

### P0/P1 minimal fixes

- None required: no P0/P1 findings were proven.
- Per non-negotiable rule, no behavior-changing code patch is proposed.

### P2/P3 safe cleanup plan (optional, non-behavioral)

1. **Align anti-chase UI text with code**
   - File/function: `src/app/risk/page.tsx` (`RiskPage` banner copy)
   - Before: says `>1 ATR`
   - After: says `>0.75 ATR` and include `>3%` condition
   - Behavior impact: none (display text only)

2. **Clarify risk labels across endpoints/UI**
   - Files: `src/app/api/positions/route.ts`, risk UI labels/components consuming these fields
   - Before: similar naming for initial-vs-open risk paths
   - After: explicit naming/labeling (no formula change)
   - Behavior impact: none (semantic clarity only)

### Validation steps

- Targeted tests:
  - `npm run test:unit -- src/lib/risk-gates.test.ts src/lib/stop-manager.test.ts src/lib/position-sizer.test.ts`
- Static checks:
  - `npm run lint`
  - `npx tsc --noEmit`
- Spot checks:
  - READY/WATCH boundaries at exactly `2.0%` and `3.0%`
  - Monday anti-chase copy vs coded thresholds
  - Compare `/api/risk` vs `/api/positions` risk field semantics for one open position

### How to rerun this audit

1. Re-read target modules listed in the request and extract every threshold/operator with `file:function:line` evidence.
2. Run focused unit tests for risk gates, stops, and position sizing.
3. Run three synthetic examples (READY, WATCH, borderline) through actual exported functions.
4. Trace API payload mapping into UI components for status/risk/stop displays.
5. Rebuild the findings table with only provable issues (no speculation).
6. Update this report date and evidence pointers.
