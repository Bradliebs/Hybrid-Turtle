# Quant Algorithm Audit Report

Date: 2026-02-15  
Scope: readiness/state classification, stops, sizing/risk, performance, re-entry logic

---

## 1) INVENTORY

### 1.1 Target modules: inputs, outputs, writes

| Module | What it computes (outputs) | What it reads (inputs) | What it writes |
|---|---|---|---|
| `src/lib/scan-engine.ts` (`runTechnicalFilters`, `classifyCandidate`, `runFullScan`) | Candidate filter pass/fail, status (`READY/WATCH/WAIT_PULLBACK/FAR`), entry trigger/stop, rank, sizing, gate pass flags | Market data (`getTechnicalData`, `getMarketRegime`, `getQuickPrice`, FX), universe from DB stocks, open positions for risk gates | Returns scan object; persisted via API scan route into `Scan`/`ScanResult` (`src/app/api/scan/route.ts`) |
| `src/lib/scan-guards.ts` (`checkAntiChasingGuard`, `checkPullbackContinuationEntry`) | Anti-chasing pass/fail + reason; pullback continuation trigger + entry/stop | Current price, entry trigger, ATR, day-of-week; HH20/EMA20/low/close | Pure functions (no write) |
| `src/lib/risk-gates.ts` (`validateRiskGates`, `getRiskBudget`, `canPyramid`) | Six gate results, budget utilization, pyramid eligibility | New position candidate + existing positions + equity + risk profile | Pure functions (no write) |
| `src/lib/stop-manager.ts` (`calculateStopRecommendation`, `updateStopLoss`, `calculateTrailingATRStop`) | Protection level transitions, recommended stop, trailing ATR stop recommendations | Entry/current/stop/ATR, DB open positions, price history from market-data | Writes `StopHistory`, updates `Position.currentStop/stopLoss/protectionLevel` |
| `prisma/sync-stops.ts` (`syncStops`) | CSV-driven stop update decisions and protection levels | `Planning/positions_state.csv`, open positions + stock tickers | Writes `StopHistory`, updates `Position` |
| `src/lib/position-sizer.ts` (`calculatePositionSize`) | Shares, total cost, risk cash, risk % | Equity, risk profile, entry/stop, sleeve cap, FX | Pure function (no write) |
| `src/lib/regime-detector.ts` (`detectRegime`, `checkRegimeStability`, `detectDualRegime`) | Regime classification and stability labels | SPY/VWRL prices + MA values + ADX/DI/VIX/A-D (for deprecated path) | Pure functions (no write) |
| `src/cron/nightly.ts` (`runNightlyProcess`) | Nightly decisions + summaries (stops, laggards, modules, snapshots, ready list) | DB positions/users, Yahoo prices/bars, stop manager, snapshot sync, risk modules | Updates stops via `updateStopLoss`, writes `Heartbeat`, writes `EquitySnapshot`, sends Telegram |
| `src/app/api/positions/route.ts` (`GET`) | Enriched position payload (R, gain %, value, `riskGBP`) | DB positions + recent stop history, live prices + FX | Read-only response |
| `src/app/api/risk/route.ts` (`GET`) | Risk budget, enriched positions, risk efficiency | DB user+positions, live prices + FX, `getRiskBudget` | Writes equity snapshot via `recordEquitySnapshot` |
| `src/app/risk/page.tsx` + `src/components/risk/*` | Risk UI rendering (budget, stops, protection progress, trailing controls) | `/api/risk`, `/api/stops/sync` payloads | UI state only |
| `prisma/schema.prisma` | DB schema contracts for Position/Stop/Scan/Risk fields | N/A | Defines persisted source-of-truth fields |
| `src/lib/risk-gates.test.ts`, `src/lib/stop-manager.test.ts`, `src/lib/position-sizer.test.ts` | Verified expected formula behavior | Unit test fixtures | Test-only |

Evidence anchors:  
- `scan-engine`: `src/lib/scan-engine.ts:runFullScan:123`, `classifyCandidate:73`, `runTechnicalFilters:41`  
- `scan-guards`: `src/lib/scan-guards.ts:checkAntiChasingGuard:5`, `checkPullbackContinuationEntry:75`  
- `risk-gates`: `src/lib/risk-gates.ts:validateRiskGates:33`, `getRiskBudget:237`, `canPyramid:167`  
- `stop-manager`: `src/lib/stop-manager.ts:calculateStopRecommendation:66`, `updateStopLoss:108`, `calculateTrailingATRStop:233`  
- `sync-stops`: `prisma/sync-stops.ts:syncStops:16`  
- `position-sizer`: `src/lib/position-sizer.ts:calculatePositionSize:20`  
- `regime-detector`: `src/lib/regime-detector.ts:detectRegime:28`, `detectDualRegime:148`  
- `nightly`: `src/cron/nightly.ts:runNightlyProcess:40`  
- API/UI: `src/app/api/positions/route.ts:GET:35`, `src/app/api/risk/route.ts:GET:14`, `src/app/risk/page.tsx:RiskPage:34`  
- Schema: `prisma/schema.prisma:model Position:58`, `StopHistory:96`, `ScanResult:120`, `EquitySnapshot:250`

### 1.2 Data flow (implemented)

- Scan universe + technicals: `runFullScan` (`src/lib/scan-engine.ts:123`)  
- Technical filters + status: `runTechnicalFilters` + `classifyCandidate` (`src/lib/scan-engine.ts:41`, `:73`)  
- Guards: anti-chase + pullback continuation (`src/lib/scan-engine.ts:297`, `src/lib/scan-guards.ts:5`, `:75`)  
- Risk gates: `validateRiskGates` (`src/lib/scan-engine.ts:279`, `src/lib/risk-gates.ts:33`)  
- Stop manager: recs + trailing updates (`src/cron/nightly.ts:100`, `:125`, `src/lib/stop-manager.ts:157`, `:311`)  
- Position sizing: `calculatePositionSize` (`src/lib/scan-engine.ts:258`, `src/lib/position-sizer.ts:20`)  
- DB sync: scan persistence + stop history + position updates (`src/app/api/scan/route.ts:46`, `src/lib/stop-manager.ts:143`, `:154`, `prisma/sync-stops.ts:118`, `:129`)  
- API: `/api/scan`, `/api/risk`, `/api/positions`, `/api/stops/sync` (`src/app/api/*/route.ts`)  
- UI: risk dashboard and scan page consume API fields (`src/app/risk/page.tsx:44`, `src/app/scan/page.tsx`)

### 1.3 Single source of truth + duplicates

- READY/WATCH/FAR status source: `scan-engine.classifyCandidate` (`src/lib/scan-engine.ts:73-81`) with later overrides (`WAIT_PULLBACK`, efficiency downgrade) (`src/lib/scan-engine.ts:234`, `:303`).
- Stop source of truth: `Position.currentStop` + `StopHistory` (`prisma/schema.prisma:72`, `:96`), mutated centrally by `updateStopLoss` (`src/lib/stop-manager.ts:108`).
- ATR source(s):
  - General ATR utility: `market-data.calculateATR` (`src/lib/market-data.ts:253`).
  - Separate trailing ATR loop inside `calculateTrailingATRStop` (`src/lib/stop-manager.ts:264-285`) (duplicated ATR implementation).
- Risk-per-trade source: `RISK_PROFILES[*].riskPerTrade` (`src/types/index.ts:24-58`).
- Open risk source for budget/gates: `(currentPrice - currentStop) * shares` in `risk-gates` (`src/lib/risk-gates.ts:50`, `:252`) and risk API (`src/app/api/risk/route.ts:77`).
- Performance source in positions API: `gainPercent`, `rMultiple`, GBP value/PnL enrichment in positions route (`src/app/api/positions/route.ts:123-129`).
- Re-entry logic source: pullback continuation (`scan-guards`) and add-on pyramiding (`risk-gates.canPyramid`); no separate "post-stop re-entry" module found in target scope.

---

## 2) RULES EXTRACT (AS CODED)

### 2A) Readiness/state classification

#### `risk-gates.ts` (`validateRiskGates`)

1. **Total Open Risk gate**  
   - Formula: `((currentOpenRisk + newPosition.riskDollars) / equity) * 100`  
   - Pass condition: `<= profile.maxOpenRisk`  
   - Existing open risk excludes HEDGE positions; per-position risk fallback: `(currentPrice - currentStop) * shares`, clamped `Math.max(0, risk)`  
   - Evidence: `src/lib/risk-gates.ts:44-62`

2. **Max Positions gate**  
   - `openPositions = nonHedgePositions.length`  
   - Pass condition: `openPositions < profile.maxPositions`  
   - Evidence: `src/lib/risk-gates.ts:65-74`

3. **Sleeve limit gate**  
   - `totalPortfolioValue = sum(existing.value) + newPosition.value`  
   - `sleevePercent = sleeveValue / totalPortfolioValue`  
   - Pass condition: `sleevePercent <= SLEEVE_CAPS[newPosition.sleeve]`  
   - Evidence: `src/lib/risk-gates.ts:77-89`

4. **Cluster concentration gate**  
   - Only if `newPosition.cluster` exists  
   - `clusterPercent = clusterValue / totalPortfolioValue`  
   - Pass condition: `clusterPercent <= caps.clusterCap`  
   - Evidence: `src/lib/risk-gates.ts:92-103`

5. **Sector concentration gate**  
   - Only if `newPosition.sector` exists  
   - `sectorPercent = sectorValue / totalPortfolioValue`  
   - Pass condition: `sectorPercent <= caps.sectorCap`  
   - Evidence: `src/lib/risk-gates.ts:107-118`

6. **Position size gate**  
   - `positionSizePercent = newPosition.value / totalPortfolioValue`  
   - Cap: `caps.positionSizeCaps[newPosition.sleeve] ?? POSITION_SIZE_CAPS.CORE`  
   - Pass condition: `positionSizePercent <= positionSizeCap`  
   - Evidence: `src/lib/risk-gates.ts:122-131`

#### `scan-guards.ts` READY/WATCH/SKIP-related logic

- Monday-only anti-chase guard active only when `dayOfWeek === 1` and `currentPrice >= entryTrigger` (`src/lib/scan-guards.ts:11-19`).
- Reject if `gapATR > 0.75` (`>` operator) (`src/lib/scan-guards.ts:25`).
- Reject if `%above > 3.0` (`>` operator) (`src/lib/scan-guards.ts:33`).
- Pullback mode is only active for `status === 'WAIT_PULLBACK'` (`src/lib/scan-guards.ts:85`).

#### `scan-engine.ts` status logic + DIST formulas

- Distance formula (percent units):  
  `distance = ((entryTrigger - price) / price) * 100`  
  Evidence: `src/lib/scan-engine.ts:77`
- **DIST_READY** (implicit): `distance <= 2` ⇒ `READY`  
  Evidence: `src/lib/scan-engine.ts:79`
- **DIST_WATCH** (implicit): `2 < distance <= 3` ⇒ `WATCH`  
  Evidence: `src/lib/scan-engine.ts:80`
- Else: `FAR` (`src/lib/scan-engine.ts:81`).
- Additional state override: if `extATR > 0.8`, set `WAIT_PULLBACK` (`src/lib/scan-engine.ts:298-303`).

### 2B) Regime detection

#### `regime-detector.ts`

- Module marked deprecated for trading decisions; comments state production gates use `getMarketRegime()` from market-data (`src/lib/regime-detector.ts:8`, `:25`).
- CHOP band constant: `CHOP_BAND_PCT = 0.02` (±2%) (`src/lib/regime-detector.ts:19`).
- `detectRegime` scoring uses SPY vs MA200, DI comparison, VIX, A/D ratio; if in chop band, regime forced to `SIDEWAYS` (`src/lib/regime-detector.ts:39-109`).
- `checkRegimeStability`: stable only if `consecutiveDays >= 3` (`>=` operator) (`src/lib/regime-detector.ts:131`).
- `detectDualRegime`: SPY+VWRL each get chop/bull/bear by ±2% around MA200; combined is BULLISH only if both bullish, BEARISH if either bearish (`src/lib/regime-detector.ts:148-177`).

#### Production regime in use (integration context)

- Live trading paths call `getMarketRegime()` (`src/lib/market-data.ts:649`).
- Rule: BULLISH if `spyPrice > spyMa200 && spyMa50 > spyMa200`; BEARISH if both below; else SIDEWAYS (`src/lib/market-data.ts:659-661`).

### 2C) Stops

#### `stop-manager.ts`

- Protection level thresholds (`getProtectionLevel`):
  - `>= 3.0` → `LOCK_1R_TRAIL`
  - `>= 2.5` → `LOCK_08R`
  - `>= 1.5` → `BREAKEVEN`
  - else `INITIAL`
  - Evidence: `src/lib/stop-manager.ts:22-26`

- Protection stop formulas (`calculateProtectionStop`):
  - `INITIAL`: `entry - initialRisk`
  - `BREAKEVEN`: `entry`
  - `LOCK_08R`: `entry + 0.5 * initialRisk`
  - `LOCK_1R_TRAIL`: `max(entry + 1.0 * initialRisk, currentPrice - 2 * currentATR)` if ATR present; else lock floor
  - Evidence: `src/lib/stop-manager.ts:40-56`

- Recommendation upgrade rule (`calculateStopRecommendation`):
  - Compute `rMultiple = (currentPrice - entryPrice) / initialRisk`
  - Upgrade only if new level index is higher than current level (`recommendedIdx > currentIdx`)
  - Monotonic guard: if `newStop <= currentStop`, return null
  - Evidence: `src/lib/stop-manager.ts:78-93`

- Hard monotonic persistence rule (`updateStopLoss`): throws if `newStop < currentStop`  
  Evidence: `src/lib/stop-manager.ts:124-130`

- Trailing ATR implementation (`calculateTrailingATRStop`):
  - Uses daily bars since entry date
  - ATR computed as simple average of rolling 14 true ranges in loop
  - Candidate trailing stop = `highestClose - atrMultiplier * atr` (default multiplier `2.0`)
  - Ratchets only upward (`candidateStop > trailingStop`)
  - Output stop rounded to 2 decimals (`Math.round(x*100)/100`)
  - Evidence: `src/lib/stop-manager.ts:233-306`

- `sync-stops.ts` CSV import path:
  - updates only if `newStop > oldStop`
  - derives protection level using `rMultiple = (newStop - entryPrice) / initialRisk`
  - writes `StopHistory` and updates `Position`
  - Evidence: `prisma/sync-stops.ts:101-131`

### 2D) Sizing

#### `position-sizer.ts`

- Input constraints for long positions: `stopPrice < entryPrice` required (`src/lib/position-sizer.ts:33`).
- Risk cash: `riskCashRaw = equity * (riskPercent / 100)` where `riskPercent = customRiskPercent ?? profile.riskPerTrade` (`src/lib/position-sizer.ts:38-41`).
- Risk per share: `(entryPrice - stopPrice) * fxToGbp` (`src/lib/position-sizer.ts:39`).
- Shares: `Math.floor(riskCash / riskPerShare)` (always round down) (`src/lib/position-sizer.ts:52`).
- Position-size cap enforcement by sleeve/profile: `shares` reduced if `shares*entry*fx > equity*cap` (`src/lib/position-sizer.ts:55-63`).
- Per-position loss cap: `per_position_max_loss_pct ?? riskPercent` then floor to cap (`src/lib/position-sizer.ts:66-70`).
- Actual risk % output: `(actualRiskDollars / equity) * 100` (`src/lib/position-sizer.ts:86`).

---

## 3) CONSISTENCY & INTEGRATION CHECKS

### Potential Mismatch A — UI watch threshold text vs coded threshold (Resolved)

- Coded WATCH threshold is `distance <= 3` (`src/lib/scan-engine.ts:80`).
- Scan UI explanatory text is now aligned to `≤ 3% from breakout` (`src/app/scan/page.tsx:361`).
- Status: fixed via UI wording update only; no classification logic changes.

### Potential Mismatch B — Cached scan route forces gates/anti-chase to pass

- DB fallback reconstruction sets `passesRiskGates: true` and `passesAntiChase: true` for all candidates (`src/app/api/scan/route.ts:202-203`).
- Original scan computes these dynamically per candidate (`src/lib/scan-engine.ts:279-292`, `:297-366`).
- Cached data can overstate executable readiness.

### Potential Mismatch C — ATR% filter threshold reconstructed as fixed 8 in cache path

- Live scan uses sleeve-aware ATR cap: HIGH_RISK uses `7`, others `8` (`src/lib/scan-engine.ts:53-55`, constants in `src/types/index.ts:80-81`).
- Cached reconstruction hardcodes `atrPercentBelow8: r.atrPercent < 8` (`src/app/api/scan/route.ts:210`).

### Potential Mismatch D — "Risk at stop" metric differs across APIs

- `/api/positions` computes `riskGBP = (entryPriceGBP - stopGBP) * shares` (`src/app/api/positions/route.ts:131`).
- `/api/risk` uses `riskDollars = (currentPriceGbp - currentStopGbp) * shares` (`src/app/api/risk/route.ts:77`), matching `risk-gates` open-risk formula (`src/lib/risk-gates.ts:50`, `:252`).
- Same label family (“risk” in UI/API) maps to different formulas.

### Potential Mismatch E — Concentration/size gates denominator is invested-position value only

- `totalPortfolioValue = existing position value + new position value` (no cash/equity denominator) (`src/lib/risk-gates.ts:77`).
- With no existing positions, sleeve/cluster/sector/position-size percentages are all 100% and fail caps.
- Verified by synthetic execution:
  - `validateRiskGates(..., existingPositions=[], equity=10000, BALANCED)` returns failed Sleeve/Cluster/Sector/Position Size despite low open-risk and position count.
  - Terminal run output captured during audit (2026-02-15).

### Nightly ordering check (stop vs snapshot)

- Nightly sequence updates stops in step 3 (`src/cron/nightly.ts:79-147`) before recording equity snapshot in step 6 (`src/cron/nightly.ts:352-368`) and snapshot sync step 7 (`src/cron/nightly.ts:429-454`); ordering is consistent with using latest stop levels before risk snapshot.

---

## 4) NUMERICAL VALIDATION (3 WORKED EXAMPLES)

Validation basis:
- Executed tests: `npm run test:unit -- src/lib/risk-gates.test.ts src/lib/stop-manager.test.ts src/lib/position-sizer.test.ts` → **26/26 passed**.
- Executed synthetic runs via `npx tsx -e` for gates/sizing/stop examples.

Assumptions for examples:
- Equity = 10,000 GBP equivalent
- Risk profile = BALANCED (`riskPerTrade=0.95`, `maxOpenRisk=5.5`) (`src/types/index.ts:32-37`)
- ATR stop multiplier = 1.5 (`src/types/index.ts:83`)

### Example 1 — Clearly READY

Inputs:
- Price = 100
- Entry trigger = 101
- ATR = 4
- Sleeve = CORE
- Existing positions = none

Step-by-step:
1. **Readiness**:  
   `distance = ((101-100)/100)*100 = 1.0%` ⇒ READY (`<=2`) (`src/lib/scan-engine.ts:77-79`)
2. **Initial stop** (scan):  
   `stop = entry - 1.5*ATR = 101 - 6 = 95` (`src/lib/scan-engine.ts:224`, `src/types/index.ts:83`)
3. **Trailing/protection** (if already in trade and at 3R):  
   For entry=100, initialRisk=10, currentPrice=130, ATR=5:  
   lock floor = 110; trail = 130 - 10 = 120; new stop = max(110,120)=120 (`src/lib/stop-manager.ts:48-56`).  
   Executed synthetic check returned `newStop=120`.
4. **Position size**:  
   risk/share = `101-95=6`; risk cash = `10000*0.95%=95`; shares=`floor(95/6)=15`; risk=`90` (`src/lib/position-sizer.ts:38-53`).
5. **Open risk contribution**:  
   candidate risk contribution = `90`; open risk % = `0.9%` (`src/lib/risk-gates.ts:57`).
6. **Gate result from implementation** with no existing positions:  
   Total Open Risk and Max Positions pass; Sleeve/Cluster/Sector/Position Size fail at 100% (synthetic execution + `src/lib/risk-gates.ts:77-131`).
7. **API/UI value mapping**:  
   - Scan UI displays `distancePercent` and `status` directly (`src/app/scan/page.tsx` READY/WATCH table).  
   - Risk UI displays `/api/risk` budget and positions directly (`src/app/risk/page.tsx:44,111-126`).

### Example 2 — Clearly WATCH

Inputs:
- Price = 100
- Entry trigger = 103
- ATR = 4

Step-by-step:
1. **Readiness**:  
   `distance = ((103-100)/100)*100 = 3.0%` ⇒ WATCH (`<=3` and not `<=2`) (`src/lib/scan-engine.ts:79-80`).
2. **Initial stop**:  
   `stop = 103 - 1.5*4 = 97`.
3. **Trailing stop**: not active pre-entry; protection progression applies only after position exists.
4. **Position size**:  
   risk/share `= 6`; risk cash `=95`; shares `=15`; risk dollars `=90` (same as Example 1 formula path).
5. **Open risk contribution**: `0.9%` of equity from this candidate risk amount.
6. **API/UI mapping check**:
   - Status from `scan-engine` is persisted in `ScanResult.status` (`src/app/api/scan/route.ts:61-66`, schema `prisma/schema.prisma:137`).
   - UI watch explanatory text now matches coded threshold (`≤ 3%`) (`src/app/scan/page.tsx:361`, `src/lib/scan-engine.ts:80`).

### Example 3 — Borderline threshold case

Inputs:
- Price = 100
- Entry trigger = 102
- ATR = 4

Step-by-step:
1. **Readiness**:  
   `distance = ((102-100)/100)*100 = 2.0%`  
   Because comparison is `<= 2`, classification is READY (borderline) (`src/lib/scan-engine.ts:79`).
2. **Initial stop**: `102 - 6 = 96`.
3. **Sizing**: shares `= floor(95/6)=15`, risk dollars `=90`, risk % `=0.9%`.
4. **Open risk + caps behavior**:
   - Open risk gate passes at `0.9% <= 5.5%`.  
   - With `existingPositions=[]`, concentration and position-size gates evaluate at 100% and fail (same denominator behavior as Example 1).
5. **API/UI match**:
   - READY count in scan response is built from candidate statuses (`src/lib/scan-engine.ts:446-447`).
   - Scan page groups READY/WATCH by `status` and table shows `distancePercent` (`src/app/scan/page.tsx` around READY/WATCH table block).

---

## 5) FINDINGS TABLE (PROVABLE ONLY)

| Severity (P0–P3) | Area | Finding | Evidence (file:function:line) | Impact | Minimal Fix | Validation Steps |
|---|---|---|---|---|---|---|
| P1 | Risk gates | Concentration/position-size gates use invested-position total as denominator, causing 100% sleeve/cluster/sector/size on first position (`existingPositions=[]`) and systematic gate failures even at low open-risk. | `src/lib/risk-gates.ts:validateRiskGates:77-131`; synthetic run output (2026-02-15) | Misclassifies readiness executable state; can block valid entries and distort gate pass rates. | In `validateRiskGates`, compute concentration/size percentages against a denominator that includes uninvested capital (e.g., equity) or explicitly gate only when denominator > threshold and behavior is intended. | Add/extend unit test in `risk-gates.test.ts` for empty-book scenario; run `npm run test:unit -- src/lib/risk-gates.test.ts`. |
| P1 | Scan cache integration | DB cache reconstruction forces `passesRiskGates=true` and `passesAntiChase=true` for all candidates. | `src/app/api/scan/route.ts:GET:202-203`; live calc source `src/lib/scan-engine.ts:279-366` | Cached scan may present blocked candidates as executable, increasing wrong-trade risk from stale/flattened gate states. | Persist and restore real gate/anti-chase outcomes (or mark unknown) instead of forcing true in cache fallback path. | Add API test/fixture or manual DB fallback check; verify candidate flags in `/api/scan` memory vs DB source are consistent. |
| P2 | UI/Readiness display | WATCH label mismatch resolved: UI now shows `≤ 3%`, matching logic `<=3%`. | `src/app/scan/page.tsx:361`; `src/lib/scan-engine.ts:classifyCandidate:80` | Resolved; removes user-facing threshold confusion. | Completed (UI text update only). | Confirm scan page cards show READY `≤ 2%` and WATCH `≤ 3%`. |
| P2 | API risk metrics | `/api/positions` risk metric uses entry-to-stop (`riskGBP`), while `/api/risk`/risk-gates use current-to-stop (`riskDollars`). | `src/app/api/positions/route.ts:131`; `src/app/api/risk/route.ts:77`; `src/lib/risk-gates.ts:50,252` | Reporting inconsistency across pages/endpoints; potential confusion during risk review. | Standardize metric naming or unify formula by endpoint intent. | Compare same position across `/api/positions` and `/api/risk` responses; ensure labels clarify formula. |
| P3 | Regime module ownership | `regime-detector.ts` documented deprecated while production trade gate uses `market-data.getMarketRegime()`. | `src/lib/regime-detector.ts:8,25`; `src/lib/market-data.ts:649-661` | Maintainability/documentation ambiguity rather than immediate trading bug. | Document canonical regime source in one place and keep deprecated module clearly non-production. | Docs/code comments check; no behavioral test required. |

---

## 6) MINIMAL FIX PLAN + VALIDATION CHECKLIST

### P1 Issue A — Risk gate denominator behavior (`validateRiskGates`)

- **Smallest change target**: `src/lib/risk-gates.ts`, function `validateRiskGates`.
- **Before**: `sleeve/cluster/sector/position-size` percentages divide by `sum(existing.value)+newPosition.value` only.
- **After (minimal safe intent)**: percentages divide by an equity-aware denominator (or skip concentration checks when denominator equals only proposed position and policy disallows that edge case explicitly). Keep gate ordering and messages intact.
- **Validation**:
  - Extend unit test for empty existing positions and low-risk single candidate to verify expected pass/fail semantics.
  - Run `npm run test:unit -- src/lib/risk-gates.test.ts`.
  - Spot-check with `npx tsx -e` synthetic call used in this audit.

### P1 Issue B — Cache fallback forcing pass flags (`/api/scan` GET)

- **Smallest change target**: `src/app/api/scan/route.ts`, DB reconstruction block in `GET`.
- **Before**: sets `passesRiskGates: true`, `passesAntiChase: true` unconditionally.
- **After**: restore persisted values where available; if unavailable, set explicit unknown state and avoid showing as pass.
- **Validation**:
  - Run a fresh scan (`POST /api/scan`), then retrieve via memory and DB fallback and compare gate flags.
  - Ensure UI stage 5 behavior does not silently assume pass for DB-restored rows.

### Global validation checklist

1. Unit tests:
   - `npm run test:unit -- src/lib/risk-gates.test.ts src/lib/stop-manager.test.ts src/lib/position-sizer.test.ts`
2. Type/lint:
   - `npm run lint`
   - `npx tsc --noEmit`
3. Spot checks:
   - READY/WATCH boundary at 2.0% and 3.0%
   - One candidate with no existing positions through risk gates
   - `/api/scan` memory vs DB fallback candidate flags
   - `/api/positions` vs `/api/risk` risk field naming/formula consistency

### How to rerun this audit

1. Re-read target modules listed in scope and collect rules with `file:function:line` evidence.
2. Run focused tests (`risk-gates`, `stop-manager`, `position-sizer`).
3. Execute at least 3 synthetic examples (READY, WATCH, borderline) via direct function calls.
4. Compare computed values to API payload fields and UI display bindings.
5. Rebuild findings table with provable items only (no speculative fixes).
6. Update this report and timestamp.
