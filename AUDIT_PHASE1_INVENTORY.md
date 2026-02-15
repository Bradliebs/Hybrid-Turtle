# AUDIT — PHASE 1: INVENTORY

**Date:** 2026-02-15  
**Scope:** Source-of-truth logic extraction only. No fixes, no suggestions, no assumptions.

---

## 1. FILE RESPONSIBILITY SUMMARY

### 1.1 `src/lib/stop-manager.ts`

**Responsibility:** Stop-loss placement, protection-level upgrades, monotonic enforcement, trailing ATR stops.

| Function | What It Computes |
|---|---|
| `getProtectionLevel(rMultiple)` | Maps R-multiple → ProtectionLevel. Thresholds: ≥3.0→LOCK_1R_TRAIL, ≥2.5→LOCK_08R, ≥1.5→BREAKEVEN, else INITIAL. |
| `calculateProtectionStop(entryPrice, initialRisk, level, currentPrice?, currentATR?)` | Computes stop price per level: INITIAL→`entry−risk`, BREAKEVEN→`entry`, LOCK_08R→`entry+0.5×risk`, LOCK_1R_TRAIL→`max(entry+1×risk, currentPrice−2×ATR)`. |
| `calculateStopRecommendation(currentPrice, entryPrice, initialRisk, currentStop, currentLevel, currentATR?)` | Computes R-multiple from `(currentPrice−entryPrice)/initialRisk`, determines recommended level, returns new stop only if level upgrades AND newStop > currentStop. |
| `updateStopLoss(positionId, newStop, reason)` | DB write. Enforces `newStop ≥ currentStop` (monotonic). After write, re-derives protection level from `(newStop−entryPrice)/initialRisk` via `getProtectionLevel`. Writes StopHistory + updates Position. |
| `generateStopRecommendations(userId, currentPrices, currentATRs?)` | Batch: iterates OPEN positions, calls `calculateStopRecommendation` per position. Returns recommendations (does NOT auto-apply). |
| `calculateTrailingATRStop(ticker, entryPrice, entryDate, currentStop, atrMultiplier=2.0)` | Fetches daily bars, walks forward from entry, tracks `highestClose`, computes `candidateStop = highestClose − 2×ATR(14)`, ratchets up monotonically. Returns trailingStop, highestClose, currentATR, shouldUpdate. |
| `generateTrailingStopRecommendations(userId)` | Batch: iterates OPEN positions, calls `calculateTrailingATRStop` per position with default 2.0× multiplier. Returns recommendations. |

---

### 1.2 `src/lib/risk-gates.ts`

**Responsibility:** Pre-trade risk cap gate checks, pyramiding rules, portfolio risk budget summary.

| Function | What It Computes |
|---|---|
| `validateRiskGates(newPosition, existingPositions, equity, riskProfile)` | Runs 6 gates: (1) Total open risk % ≤ `profile.maxOpenRisk` (ex-HEDGE), (2) Open position count < `profile.maxPositions` (ex-HEDGE), (3) Sleeve value % ≤ `SLEEVE_CAPS[sleeve]`, (4) Cluster value % ≤ `caps.clusterCap`, (5) Sector value % ≤ `caps.sectorCap`, (6) Position size % ≤ `caps.positionSizeCaps[sleeve]`. Returns pass/fail per gate. Open risk per position: `riskDollars ?? (currentPrice−currentStop)×shares`, floored at 0. |
| `canPyramid(currentPrice, entryPrice, initialRisk, atr?, currentAdds?)` | Max 2 adds. ATR triggers: add#1 at `entry+0.5×ATR`, add#2 at `entry+1.0×ATR`. Fallback: R-multiple ≥ 1.0 when ATR unavailable. |
| `getRiskBudget(positions, equity, riskProfile)` | Computes: usedRiskPercent (ex-HEDGE, using `riskDollars ?? (currentPrice−currentStop)×shares`), availableRiskPercent, maxRiskPercent, usedPositions (ex-HEDGE), maxPositions, sleeveUtilization (value %). |

**Constants used (from `types/index.ts`):**
- `RISK_PROFILES[profile].maxOpenRisk` / `.maxPositions` / `.riskPerTrade`
- `SLEEVE_CAPS`: CORE=0.80, ETF=0.80, HIGH_RISK=0.40, HEDGE=1.00
- `POSITION_SIZE_CAPS`: CORE=0.16, ETF=0.16, HIGH_RISK=0.12, HEDGE=0.20
- `CLUSTER_CAP`=0.20, `SECTOR_CAP`=0.25
- Profile overrides via `getProfileCaps()`: SMALL_ACCOUNT (cluster 0.25, sector 0.30, CORE pos 0.20), BALANCED (CORE pos 0.18), AGGRESSIVE (cluster 0.35, sector 0.45, CORE/ETF pos 0.40, HIGH_RISK pos 0.20)

---

### 1.3 `src/lib/regime-detector.ts`

**Responsibility:** Market regime classification (BULLISH / SIDEWAYS / BEARISH), CHOP band, stability filter, dual benchmark.

| Function | What It Computes |
|---|---|
| `detectRegime(input: RegimeInput)` | Point-scoring: SPY vs 200MA (±3pts), +DI vs −DI (±2pts), VIX (<20 +1 / >30 −1), A/D ratio (>1.2 +1 / <0.8 −1). ±2% CHOP band around 200MA → forces SIDEWAYS. Otherwise: ≥5 bullish → BULLISH, ≥5 bearish → BEARISH, else SIDEWAYS. |
| `checkRegimeStability(currentRegime, regimeHistory)` | Requires 3 consecutive days of same regime to confirm. If unstable → returns `CHOP` (displayed as SIDEWAYS). |
| `detectDualRegime(spyPrice, spyMa200, vwrlPrice, vwrlMa200)` | SPY + VWRL each get ±2% chop band. Combined: both BULLISH → BULLISH, either BEARISH → BEARISH, else SIDEWAYS. |
| `canBuy(regime)` | Returns `regime === 'BULLISH'`. |

**Constants:** `CHOP_BAND_PCT = 0.02`

---

### 1.4 `src/lib/position-sizer.ts`

**Responsibility:** Position sizing from risk budget, entry trigger, R-multiple / gain calculations.

| Function | What It Computes |
|---|---|
| `calculatePositionSize(input)` | `riskPerShare = (entryPrice−stopPrice) × fxToGbp`. `riskCash = equity × (riskPercent/100)`, clamped by `risk_cash_cap` / `risk_cash_floor` if defined. `shares = floor(riskCash / riskPerShare)`. Then enforces position size cap: `shares×entry×fxToGbp ≤ equity × cap%`. Then enforces per-position max loss: `riskPerShare×shares ≤ equity × perPositionMaxLossPct/100`. Validates: equity>0, entryPrice>0, stopPrice>0, stopPrice<entryPrice. |
| `calculateEntryTrigger(twentyDayHigh, atr)` | `twentyDayHigh + 0.1 × ATR` |
| `calculateRMultiple(currentPrice, entryPrice, initialRisk)` | `(currentPrice − entryPrice) / initialRisk` |
| `calculateGainPercent(currentPrice, entryPrice)` | `((currentPrice − entryPrice) / entryPrice) × 100` |
| `calculateGainDollars(currentPrice, entryPrice, shares)` | `(currentPrice − entryPrice) × shares` |

---

### 1.5 `src/lib/scan-engine.ts`

**Responsibility:** 7-stage scan pipeline: Universe → Technical Filters → Classification → Ranking → Risk Gates → Anti-Chase → Sizing.

| Function | What It Computes |
|---|---|
| `getUniverse()` | DB query: all active stocks → ticker, name, sleeve, sector, cluster, currency. |
| `runTechnicalFilters(price, technicals, sleeve)` | Checks: price > ma200, adx ≥ 20, +DI > −DI, atrPercent < cap (8 for all, 7 for HIGH_RISK), ma200 > 0 && adx > 0. `passesAll` = all true. Also checks `efficiency ≥ 30` separately. |
| `classifyCandidate(price, entryTrigger)` | `distance = ((trigger−price)/price)×100`. ≤2% → READY, ≤3% → WATCH, else FAR. |
| `rankCandidate(sleeve, technicals, status)` | Weighted score: sleeve priority (CORE=40, ETF=20, HIGH_RISK=10, HEDGE=5) + status bonus (READY=30, WATCH=10) + ADX×0.3 (capped 50) + volumeRatio×5 (capped 3) + efficiency×0.2 (capped 100) + relativeStrength×0.1 (capped 100). |
| `runFullScan(userId, riskProfile, equity)` | Full pipeline: fetches universe, gets market regime via `getMarketRegime()`, fetches technicals per ticker in batches of 10, applies filters, adaptive buffer, classification, ATR spike handling (SOFT_CAP→WATCH if bullish DI, HARD_BLOCK→FAR if bearish DI), efficiency gate (below 30 → WATCH), ranking, position sizing via `calculatePositionSize`, risk gates via `validateRiskGates`, anti-chase guard (ext_ATR > 0.8 → WAIT_PULLBACK), pullback continuation check, sorting (triggered first → READY → WATCH → FAR, then by rank). |

**ATR spike handling in scan:**  
- `atrSpiking && bullishDI` → SOFT_CAP: READY downgraded to WATCH  
- `atrSpiking && !bullishDI` → HARD_BLOCK: passesAllFilters=false, status=FAR  

**Stop price in scan:** `entryTrigger − ATR × ATR_STOP_MULTIPLIER` (where `ATR_STOP_MULTIPLIER = 1.5`)

---

### 1.6 `src/lib/scan-guards.ts`

**Responsibility:** Anti-chase execution guard and pullback continuation entry logic.

| Function | What It Computes |
|---|---|
| `checkAntiChasingGuard(currentPrice, entryTrigger, atr, dayOfWeek)` | **Monday only** (dayOfWeek === 1). If price ≥ trigger: fail if `gap/ATR > 0.75` or `percentAbove > 3.0%`. Non-Monday → always passes. Below trigger → always passes. |
| `checkPullbackContinuationEntry(input)` | Only for WAIT_PULLBACK status. `anchor = max(HH20, EMA20)`, zone = `anchor ± 0.25×ATR`. Triggers if low dips into zone AND close > zoneHigh. Stop = `pullbackLow − 0.5×ATR`. |

---

### 1.7 `src/cron/nightly.ts`

**Responsibility:** 9-step nightly batch process. Orchestrator — calls into other modules.

| Step | What It Does |
|---|---|
| 1 | Runs 16-point health check (`runHealthCheck`) |
| 2 | Fetches OPEN positions + live batch prices + GBP normalisation |
| 3 | Generates R-based stop recommendations (`generateStopRecommendations`) with ATR map, **auto-applies** via `updateStopLoss`. Then generates trailing ATR stops (`generateTrailingStopRecommendations`), **auto-applies** via `updateStopLoss`. |
| 4 | Detects laggards (`detectLaggards`) |
| 5 | Runs risk-signal modules: climax (`scanClimaxSignals`), swap suggestions (`findSwapSuggestions`), whipsaw blocks (`checkWhipsawBlocks`), breadth safety (`calculateBreadth`/`checkBreadthSafety` on 30-ticker sample), momentum expansion (`checkMomentumExpansion` using SPY ADX) |
| 6 | Records equity snapshot (`recordEquitySnapshot`). Computes inline open risk: `Σ max(0, (gbpPrice − currentStopGbp) × shares)` for non-HEDGE. Checks pyramid eligibility (`canPyramid`) for each position. |
| 7 | Syncs snapshot data from Yahoo (`syncSnapshot`). Queries READY candidates from `snapshotTicker` table. Detects trigger-met candidates (close ≥ entryTrigger, not held). |
| 8 | Sends Telegram summary |
| 9 | Writes heartbeat record |

**Key:** Nightly **auto-applies** stop updates (Step 3). The scan engine does NOT auto-apply — it only recommends.

---

### 1.8 `prisma/sync-stops.ts`

**Responsibility:** One-off CLI script to import trailing stops from `Planning/positions_state.csv` into DB.

| Function | What It Computes |
|---|---|
| `syncStops()` | Reads CSV (ticker, active_stop, entry_price, initial_stop). Matches to OPEN positions by ticker (handles .L / T212 lowercase-l formats). Only updates if `newStop > oldStop` (monotonic). Computes protection level inline using `(newStop − entryPrice + initialRisk) / initialRisk` with same thresholds as `getProtectionLevel`. Writes StopHistory + updates Position. |

---

### 1.9 `src/app/api/positions/route.ts`

**Responsibility:** CRUD API for positions. GET enriches with live prices + computed fields. POST creates positions with pre-trade gates. PATCH closes positions.

| Method | What It Computes / Exposes |
|---|---|
| **GET** | Fetches positions from DB. Fetches live prices via `getBatchPrices`. Normalises to GBP via `normalizeBatchPricesToGBP`. Computes per position: `gainPercent` (via `calculateGainPercent`), `rMultiple` (via `calculateRMultiple`), `gainDollars = currentPriceGBP×shares − entryPriceGBP×shares`, `value = currentPriceGBP×shares`, `riskGBP = (entryPriceGBP − stopGBP) × shares`. Exposes `pyramidAdds` count from TradeLog. |
| **POST** | Pre-trade gates: (1) Phase ≠ OBSERVATION (Monday block), (2) Regime = BULLISH (via `getMarketRegime`), (3) Health ≠ RED. Validates stopLoss < entryPrice. Computes `initialRisk = entryPrice − stopLoss`. Creates position + best-effort TradeLog entry. |
| **PATCH** | Closes position. Resolves exitReason (STOP_HIT if exitPrice ≤ currentStop or explicit). Creates TradeLog exit entry with `finalRMultiple = (exitPrice−entryPrice)/initialR`, `gainLossGbp`, `daysHeld`. |

---

### 1.10 `src/app/api/risk/route.ts`

**Responsibility:** Portfolio risk summary API endpoint. Enriches positions, delegates to `getRiskBudget`, computes risk efficiency metric.

| What It Computes |
|---|
| Fetches OPEN positions, live prices, normalises to GBP. Per position: `rMultiple` (via `calculateRMultiple` on raw prices), `value = currentPriceGbp × shares`, `riskDollars = max(0, (currentPriceGbp − currentStopGbp) × shares)`. Calls `getRiskBudget(enriched, equity, riskProfile)` to get budget. Calls `recordEquitySnapshot`. Calls `getWeeklyEquityChangePercent` for efficiency metric. Computes `riskEfficiency = weeklyChangePercent / maxOpenRiskUsedPercent`. |

---

## 2. DATA FLOW DIAGRAM

```
SCAN PIPELINE (scan-engine.ts:runFullScan)
│
├─► Stage 1: getUniverse() ── DB: Stock table (active=true)
│
├─► Stage 2: runTechnicalFilters() ── market-data.ts:getTechnicalData()
│   └─ price > ma200, adx ≥ 20, +DI > −DI, atrPct < cap, data quality
│   └─ ATR spike check (atrSpiking field from market-data)
│   └─ efficiency ≥ 30 check
│
├─► Stage 3: classifyCandidate() ── distance to entry trigger
│   └─ entryTrigger from adaptive-atr-buffer module
│   └─ stopPrice = entryTrigger − 1.5 × ATR
│   └─ ≤2% → READY, ≤3% → WATCH, else FAR
│
├─► Stage 4: rankCandidate() ── sleeve + status + ADX + volume + efficiency + RS
│
├─► Stage 5: validateRiskGates() ── risk-gates.ts
│   └─ Needs: existing OPEN positions (with GBP values), equity
│   └─ 6 gates: total risk, position count, sleeve, cluster, sector, position size
│
├─► Stage 6: checkAntiChasingGuard() ── scan-guards.ts (Monday only)
│   └─ ext_ATR > 0.8 → WAIT_PULLBACK (in scan-engine, before guard)
│   └─ gap > 0.75 ATR or > 3.0% → fail
│   └─ checkPullbackContinuationEntry() if WAIT_PULLBACK
│
├─► Stage 7: calculatePositionSize() ── position-sizer.ts
│   └─ shares, riskDollars, totalCost
│
└─► Output: ScanCandidate[] with status, sizing, gate results
        │
        ▼
    SCAN API (api/scan or snapshot-sync) ── persists to DB (Scan + ScanResult or SnapshotTicker)
        │
        ▼
    NIGHTLY (cron/nightly.ts)
    │
    ├─► Step 3: STOP UPDATES
    │   ├─ generateStopRecommendations() ── R-based stops (stop-manager.ts)
    │   │   └─ uses live prices + ATR map
    │   │   └─ auto-applies via updateStopLoss()
    │   └─ generateTrailingStopRecommendations() ── trailing ATR stops
    │       └─ 2×ATR(14) below highest close since entry
    │       └─ auto-applies via updateStopLoss()
    │
    ├─► Step 5: RISK SIGNALS
    │   └─ climax, swap, whipsaw, breadth, momentum modules
    │
    ├─► Step 6: EQUITY SNAPSHOT + PYRAMID CHECK
    │   └─ open risk computed inline (not via getRiskBudget)
    │   └─ canPyramid() from risk-gates.ts
    │
    ├─► Step 7: SNAPSHOT SYNC + READY QUERY
    │   └─ syncSnapshot() → DB: SnapshotTicker
    │   └─ queries READY candidates, trigger-met candidates
    │
    └─► Step 8-9: TELEGRAM + HEARTBEAT
        │
        ▼
    CSV IMPORT (prisma/sync-stops.ts)
    │
    └─► Reads Planning/positions_state.csv
        └─ Matches tickers → OPEN positions
        └─ Updates stop if CSV stop > DB stop (monotonic)
        └─ Computes protection level inline (NOT via getProtectionLevel)
        │
        ▼
    API: POSITIONS (api/positions/route.ts)
    │
    ├─► GET: DB positions + live prices → enriched with rMultiple, gainPercent,
    │   gainDollars, value (GBP), riskGBP (entry-based)
    │
    ├─► POST: Pre-trade gates (phase, regime, health) → create position
    │
    └─► PATCH: Close position → TradeLog with finalRMultiple
        │
        ▼
    API: RISK (api/risk/route.ts)
    │
    └─► GET: DB positions + live prices → enriched → getRiskBudget()
        └─ riskDollars = max(0, (currentPriceGbp − currentStopGbp) × shares)
        └─ recordEquitySnapshot()
        └─ riskEfficiency = weeklyEquityChange / maxOpenRiskUsed
        │
        ▼
    UI (dashboard, portfolio, risk, scan pages)
    └─► Consumes API responses — no additional computation
```

---

## 3. COMPUTE vs EXPOSE CLASSIFICATION

| Module | Computes Values | Exposes DB Values |
|---|---|---|
| `stop-manager.ts` | **YES** — calculates protection levels, trailing ATR stops, stop recommendations | Reads positions from DB for batch operations |
| `risk-gates.ts` | **YES** — computes open risk %, gate pass/fail, pyramid eligibility, risk budget | Receives position data as arguments (does not query DB) |
| `regime-detector.ts` | **YES** — computes regime from technical inputs, stability, dual benchmark | Pure functions, no DB access |
| `position-sizer.ts` | **YES** — computes shares, riskDollars, totalCost, R-multiple, gain% | Pure functions, no DB access |
| `scan-engine.ts` | **YES** — orchestrates all 7 stages, computes filters/classification/ranking/sizing | Reads DB (universe, positions), calls market-data APIs |
| `scan-guards.ts` | **YES** — computes anti-chase guard, pullback continuation | Pure functions, no DB access |
| `nightly.ts` | **MIXED** — orchestrates, calls compute modules, also computes open risk inline (Step 6) | Reads/writes DB extensively |
| `sync-stops.ts` | **MIXED** — computes protection level inline, reads CSV | Writes to DB |
| `api/positions/route.ts` | **MIXED** — computes rMultiple, gainPercent, gainDollars, value, riskGBP from live prices | Reads/writes DB, passes through to UI |
| `api/risk/route.ts` | **MIXED** — computes riskDollars per position, delegates to getRiskBudget, computes riskEfficiency | Reads DB, passes through to UI |

---

## 4. DUPLICATE CALCULATION LOGIC

### 4.1 Protection Level Determination — **DUPLICATED WITH MISMATCH**

| Location | R-multiple Formula | Thresholds |
|---|---|---|
| `stop-manager.ts:getProtectionLevel` | `(currentPrice − entryPrice) / initialRisk` | ≥3.0, ≥2.5, ≥1.5 |
| `stop-manager.ts:updateStopLoss` (L126) | `(newStop − entryPrice) / initialRisk` | Same thresholds via `getProtectionLevel` |
| `sync-stops.ts` (L106) | `(newStop − entryPrice + initialRisk) / initialRisk` | Same thresholds (≥3.0, ≥2.5, ≥1.5) |

**Observation:** `sync-stops.ts` uses a **different R-multiple formula**. It computes `(newStop − entryPrice + initialRisk) / initialRisk` which simplifies to `(newStop − entryPrice)/initialRisk + 1`. This shifts all thresholds by +1R compared to `stop-manager.ts:updateStopLoss` which uses `(newStop − entryPrice)/initialRisk`. The same newStop value will produce a protection level one tier higher in `sync-stops.ts` than in `stop-manager.ts`.

### 4.2 Open Risk Calculation — **DUPLICATED, 3 LOCATIONS**

| Location | Formula | Notes |
|---|---|---|
| `risk-gates.ts:validateRiskGates` (Gate 1) | `riskDollars ?? (currentPrice − currentStop) × shares`, floored at 0 | Excludes HEDGE. Uses provided values. |
| `risk-gates.ts:getRiskBudget` | `riskDollars ?? (currentPrice − currentStop) × shares`, floored at 0 | Excludes HEDGE. Same formula. |
| `nightly.ts` Step 6 (L318–326) | `max(0, (gbpPrice − currentStopGbp) × shares)` | Excludes HEDGE. Computed inline, NOT via `getRiskBudget`. |
| `api/risk/route.ts` (L65) | `max(0, (currentPriceGbp − currentStopGbp) × shares)` | Enriches before passing to `getRiskBudget`. |

**Observation:** Logically consistent (all use currentPrice − currentStop), but nightly.ts computes inline instead of calling `getRiskBudget`.

### 4.3 riskGBP in Positions API — **DIFFERENT SEMANTICS**

| Location | Formula | Semantics |
|---|---|---|
| `api/positions/route.ts` GET (L113) | `(entryPriceGBP − stopGBP) × shares` | Risk from **entry** to stop (initial risk in GBP) |
| `api/risk/route.ts` GET (L65) | `max(0, (currentPriceGbp − currentStopGbp) × shares)` | Risk from **current price** to stop (effective open risk) |

**Observation:** The positions API exposes `riskGBP` based on entry price (initial risk), while the risk API computes `riskDollars` based on current price (effective open risk). These are semantically different quantities with confusingly similar names.

### 4.4 R-multiple Calculation — DUPLICATED, CONSISTENT

| Location | Formula |
|---|---|
| `position-sizer.ts:calculateRMultiple` | `(currentPrice − entryPrice) / initialRisk` |
| `api/positions/route.ts` GET | Calls `calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk)` |
| `api/risk/route.ts` GET | Calls `calculateRMultiple(currentPriceRaw, p.entryPrice, p.initialRisk)` |
| `nightly.ts` Step 7 (position details) | Inline: `p.initialRisk > 0 ? (currentPrice − p.entryPrice) / p.initialRisk : 0` |
| `nightly.ts` Step 5 (swap enrichment) | Calls `calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk)` |

**Observation:** Formula is consistent across all locations. Nightly Step 7 inlines instead of calling the function, but the math matches.

### 4.5 GBX/GBP Currency Detection — DUPLICATED, CONSISTENT PATTERN

The pattern `ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker)` is repeated in:
- `stop-manager.ts:generateTrailingStopRecommendations` (L290)
- `scan-engine.ts:runFullScan` (L131, L153, L220)
- `nightly.ts` (L84, L131, L226, L276, L361)
- `api/positions/route.ts` (L91)
- `api/risk/route.ts` (L66)

No centralised helper. Same regex everywhere.

### 4.6 Anti-Chase Guard — TWO GUARD POINTS

| Location | Trigger |
|---|---|
| `scan-engine.ts:runFullScan` (L177) | `ext_ATR = (price − entryTrigger) / ATR > 0.8` → forces WAIT_PULLBACK before calling `checkAntiChasingGuard` |
| `scan-guards.ts:checkAntiChasingGuard` | `gap/ATR > 0.75` or `percentAbove > 3.0%` → fail (Monday only) |

**Observation:** scan-engine applies a 0.8 ATR threshold BEFORE the guard's 0.75 ATR threshold. The outer check (0.8) is stricter and fires regardless of day-of-week. The inner check (0.75) only applies on Mondays. These are two separate guard layers with different thresholds.

---

**END OF PHASE 1 INVENTORY.**

---
---

# AUDIT — PHASE 2: RULES EXTRACT

**Date:** 2026-02-15  
**Scope:** Exact implemented rules with file:function:line references. No interpretation. No optimisation.

---

## A) READINESS — Technical Filters, Classification, Guards, Exposure & Regime Gating

### A.1 Technical Filter Rules

**Source:** [scan-engine.ts:runTechnicalFilters](src/lib/scan-engine.ts#L40)

| # | Filter | Comparison | Threshold | Line |
|---|---|---|---|---|
| 1 | Price vs 200-day MA | `price > technicals.ma200` | strict `>` | [L59](src/lib/scan-engine.ts#L59) |
| 2 | ADX trend strength | `technicals.adx >= 20` | `>=` 20 | [L60](src/lib/scan-engine.ts#L60) |
| 3 | Directional movement | `technicals.plusDI > technicals.minusDI` | strict `>` | [L61](src/lib/scan-engine.ts#L61) |
| 4a | ATR% volatility cap (all sleeves) | `technicals.atrPercent < atrThreshold` | strict `<` 8 | [L62](src/lib/scan-engine.ts#L62), constant [types/index.ts L79](src/types/index.ts#L79) |
| 4b | ATR% volatility cap (HIGH_RISK) | `technicals.atrPercent < atrThreshold` | strict `<` 7 | [L53–54](src/lib/scan-engine.ts#L53), constant [types/index.ts L80](src/types/index.ts#L80) |
| 5 | Data quality | `technicals.ma200 > 0 && technicals.adx > 0` | strict `>` 0 | [L63](src/lib/scan-engine.ts#L63) |

**passesAll:** All 5 filters above must be `true`. [L67](src/lib/scan-engine.ts#L67): `Object.values(filters).every(Boolean)`

**Efficiency filter (separate):** `technicals.efficiency >= 30` ([L66](src/lib/scan-engine.ts#L66)). This is NOT included in `passesAll`. Applied later: if `efficiencyAbove30` is false AND status is READY → downgrade to WATCH ([L244](src/lib/scan-engine.ts#L244)).

### A.2 ATR Spike Override Rules

**Source:** [scan-engine.ts:runFullScan](src/lib/scan-engine.ts#L233)

| Condition | Action | Status Change | Line |
|---|---|---|---|
| `atrSpiking === true && plusDI > minusDI` | SOFT_CAP | READY → WATCH | [L237–239](src/lib/scan-engine.ts#L237) |
| `atrSpiking === true && plusDI <= minusDI` | HARD_BLOCK | passesAllFilters = false, status = FAR | [L240–243](src/lib/scan-engine.ts#L240) |

Note: `atrSpiking` is a field from `getTechnicalData()` in market-data.ts. The spiking logic itself is not in scan-engine.

### A.3 DIST_READY / DIST_WATCH — Status Classification

**Source:** [scan-engine.ts:classifyCandidate](src/lib/scan-engine.ts#L73)

```
distance = ((entryTrigger - price) / price) * 100
```

| Status | Comparison | Threshold | Line |
|---|---|---|---|
| READY | `distance <= 2` | ≤ 2.0% | [L79](src/lib/scan-engine.ts#L79) |
| WATCH | `distance <= 3` | ≤ 3.0% (and > 2.0%) | [L80](src/lib/scan-engine.ts#L80) |
| FAR | else | > 3.0% | [L81](src/lib/scan-engine.ts#L81) |

**distance** is percentage distance from current price UP to entry trigger. Positive = price is below trigger. At or above trigger → distance ≤ 0 → READY.

### A.4 Entry Trigger Calculation

**Source:** [modules/adaptive-atr-buffer.ts:calculateAdaptiveBuffer](src/lib/modules/adaptive-atr-buffer.ts#L19)

```
adjustedEntryTrigger = twentyDayHigh + bufferPercent × ATR
```

Buffer scaling:

| ATR% | Buffer % of ATR | Line |
|---|---|---|
| ≤ 2.0 | 20% (maxBuffer) | [L31](src/lib/modules/adaptive-atr-buffer.ts#L31) |
| ≥ 6.0 | 5% (minBuffer) | [L33](src/lib/modules/adaptive-atr-buffer.ts#L33) |
| 2.0 < ATR% < 6.0 | Linear interpolation: `0.20 − ((atrPercent − 2) / 4) × 0.15` | [L36](src/lib/modules/adaptive-atr-buffer.ts#L36) |

Fallback entry trigger (not adaptive): [position-sizer.ts:calculateEntryTrigger](src/lib/position-sizer.ts#L102): `twentyDayHigh + 0.1 × ATR` (fixed 10%).

Scan uses adaptive buffer ([scan-engine.ts L222](src/lib/scan-engine.ts#L222)).

### A.5 Anti-Chase Execution Guard

**Source:** [scan-guards.ts:checkAntiChasingGuard](src/lib/scan-guards.ts#L5)

| Rule | Comparison | Threshold | Line |
|---|---|---|---|
| Day-of-week gate | `dayOfWeek !== 1` | Only active on Monday (1) | [L15](src/lib/scan-guards.ts#L15) |
| Below trigger | `currentPrice < entryTrigger` | Always passes | [L20](src/lib/scan-guards.ts#L20) |
| Gap in ATR | `gapATR > 0.75` | strict `>` 0.75 | [L29](src/lib/scan-guards.ts#L29) |
| Percent above trigger | `percentAbove > 3.0` | strict `>` 3.0% | [L36](src/lib/scan-guards.ts#L36) |

Where: `gap = currentPrice − entryTrigger`, `gapATR = gap / atr`, `percentAbove = ((currentPrice / entryTrigger) − 1) × 100`.

### A.6 Pre-guard in Scan Engine (ext_ATR check)

**Source:** [scan-engine.ts:runFullScan](src/lib/scan-engine.ts#L278)

```
extATR = (price - entryTrigger) / technicals.atr
if (extATR > 0.8) → status = 'WAIT_PULLBACK'
```

| Rule | Comparison | Threshold | Line |
|---|---|---|---|
| Extension ATR | `extATR > 0.8` | strict `>` 0.80 | [L279](src/lib/scan-engine.ts#L279) |

This fires regardless of day-of-week, before `checkAntiChasingGuard` is called. Threshold 0.80 is stricter-in-scope than the guard's 0.75 (the guard is Monday-only).

### A.7 Pullback Continuation Entry (Mode B)

**Source:** [scan-guards.ts:checkPullbackContinuationEntry](src/lib/scan-guards.ts#L75)

| Rule | Formula | Line |
|---|---|---|
| Precondition | `status === 'WAIT_PULLBACK'` | [L93](src/lib/scan-guards.ts#L93) |
| Anchor | `max(HH20, EMA20)` | [L83](src/lib/scan-guards.ts#L83) |
| Zone width | `0.25 × ATR` each side of anchor | [L84](src/lib/scan-guards.ts#L84) |
| Zone bounds | `zoneLow = anchor − 0.25 × ATR`, `zoneHigh = anchor + 0.25 × ATR` | [L85–86](src/lib/scan-guards.ts#L85) |
| Dip condition | `low <= zoneHigh && low >= zoneLow` | [L107](src/lib/scan-guards.ts#L107) |
| Close condition | `close > zoneHigh` | strict `>` | [L108](src/lib/scan-guards.ts#L108) |
| Trigger | Both conditions must be true | [L110](src/lib/scan-guards.ts#L110) |
| Entry price | `close` | [L118](src/lib/scan-guards.ts#L118) |
| Stop price | `(pullbackLow ?? low) − 0.5 × ATR` | [L117](src/lib/scan-guards.ts#L117) |

### A.8 Exposure Gates (Risk Gates)

**Source:** [risk-gates.ts:validateRiskGates](src/lib/risk-gates.ts#L33)

| Gate # | What | Comparison | Cap Value | Line |
|---|---|---|---|---|
| 1 | Total open risk % (ex-HEDGE) | `totalOpenRiskPercent <= profile.maxOpenRisk` | `<=`, profile-dependent | [L60](src/lib/risk-gates.ts#L60) |
| 2 | Open position count (ex-HEDGE) | `openPositions < profile.maxPositions` | strict `<` | [L70](src/lib/risk-gates.ts#L70) |
| 3 | Sleeve allocation % | `sleevePercent <= sleeveCap` | `<=` | [L82](src/lib/risk-gates.ts#L82) |
| 4 | Cluster concentration % | `clusterPercent <= caps.clusterCap` | `<=` | [L95](src/lib/risk-gates.ts#L95) |
| 5 | Sector concentration % | `sectorPercent <= caps.sectorCap` | `<=` | [L108](src/lib/risk-gates.ts#L108) |
| 6 | Position size % | `positionSizePercent <= positionSizeCap` | `<=` | [L121](src/lib/risk-gates.ts#L121) |

**Cap values by profile** (from [types/index.ts](src/types/index.ts)):

| Profile | riskPerTrade | maxPositions | maxOpenRisk | Line |
|---|---|---|---|---|
| CONSERVATIVE | 0.75% | 8 | 7.0% | [L27](src/types/index.ts#L27) |
| BALANCED | 0.95% | 5 | 5.5% | [L33](src/types/index.ts#L33) |
| SMALL_ACCOUNT | 1.5% | 4 | 10.0% | [L39](src/types/index.ts#L39) |
| AGGRESSIVE | 2.0% | 2 | 6.0% | [L45](src/types/index.ts#L45) |

| Sleeve | Default Cap | Line |
|---|---|---|
| CORE | 0.80 (80%) | [L63](src/types/index.ts#L63) |
| ETF | 0.80 (80%) | [L64](src/types/index.ts#L64) |
| HIGH_RISK | 0.40 (40%) | [L65](src/types/index.ts#L65) |
| HEDGE | 1.00 (100%) | [L66](src/types/index.ts#L66) |

| Sleeve | Default Position Size Cap | Line |
|---|---|---|
| CORE | 0.16 (16%) | [L70](src/types/index.ts#L70) |
| ETF | 0.16 (16%) | [L71](src/types/index.ts#L71) |
| HIGH_RISK | 0.12 (12%) | [L72](src/types/index.ts#L72) |
| HEDGE | 0.20 (20%) | [L73](src/types/index.ts#L73) |

| Constant | Default Value | Line |
|---|---|---|
| CLUSTER_CAP | 0.20 (20%) | [L76](src/types/index.ts#L76) |
| SECTOR_CAP | 0.25 (25%) | [L77](src/types/index.ts#L77) |

**Profile overrides** ([types/index.ts L98–122](src/types/index.ts#L98)):

| Profile | clusterCap | sectorCap | CORE pos cap | Other pos caps |
|---|---|---|---|---|
| SMALL_ACCOUNT | 0.25 | 0.30 | 0.20 | defaults |
| BALANCED | default | default | 0.18 | defaults |
| AGGRESSIVE | 0.35 | 0.45 | 0.40 | ETF=0.40, HIGH_RISK=0.20, HEDGE=0.20 |

**Gate 1 open risk formula** ([risk-gates.ts L52–57](src/lib/risk-gates.ts#L52)):
```
posRisk = p.riskDollars ?? (p.currentPrice - p.currentStop) * p.shares
posRisk = Math.max(0, posRisk)
totalOpenRiskPercent = ((currentOpenRisk + newPosition.riskDollars) / equity) * 100
```

**Gate 2 comparison note:** Uses strict `<` (not `<=`), meaning `openPositions < maxPositions`. The count used is `nonHedgePositions.length` (before adding the new position). The message displays `openPositions + 1`.

### A.9 Regime Gating (Pre-trade)

**Source:** [api/positions/route.ts POST](src/app/api/positions/route.ts#L196)

| Gate | Comparison | Value | Line |
|---|---|---|---|
| Weekly phase | `phase === 'OBSERVATION'` | Blocks on Monday | [L192](src/app/api/positions/route.ts#L192) |
| Market regime | `regime !== 'BULLISH'` | Must be BULLISH | [L197](src/app/api/positions/route.ts#L197) |
| Health status | `latestHealth?.overall === 'RED'` | Blocks on RED | [L204](src/app/api/positions/route.ts#L204) |
| Stop validation | `stopLoss >= entryPrice` | Stop must be `<` entry | [L209](src/app/api/positions/route.ts#L209) |

The regime used here is from `getMarketRegime()` ([market-data.ts L534](src/lib/market-data.ts#L534)) — NOT from `detectRegime()` in regime-detector.ts. These are different functions (see Section B).

Weekly phase logic ([types/index.ts L153–163](src/types/index.ts#L153)):
```
Sun → PLANNING
Mon → OBSERVATION  (entries blocked)
Tue → EXECUTION
Wed–Sat → MAINTENANCE
```

### A.10 Ranking Formula

**Source:** [scan-engine.ts:rankCandidate](src/lib/scan-engine.ts#L85)

```
score = sleevePriority[sleeve]
      + statusBonus
      + min(adx, 50) × 0.3
      + min(volumeRatio, 3) × 5
      + min(efficiency, 100) × 0.2
      + min(relativeStrength, 100) × 0.1
```

| Component | Values | Line |
|---|---|---|
| Sleeve priority | CORE=40, ETF=20, HIGH_RISK=10, HEDGE=5 | [L92–97](src/lib/scan-engine.ts#L92) |
| Status bonus | READY=30, WATCH=10, else 0 | [L100–101](src/lib/scan-engine.ts#L100) |
| ADX | capped at 50, × 0.3 | [L104](src/lib/scan-engine.ts#L104) |
| Volume ratio | capped at 3, × 5 | [L107](src/lib/scan-engine.ts#L107) |
| Efficiency | capped at 100, × 0.2 | [L110](src/lib/scan-engine.ts#L110) |
| Relative strength | capped at 100, × 0.1 | [L113](src/lib/scan-engine.ts#L113) |

Score is rounded to 2 decimal places ([L115](src/lib/scan-engine.ts#L115)).

### A.11 Pyramiding Rules

**Source:** [risk-gates.ts:canPyramid](src/lib/risk-gates.ts#L156), config at [L138](src/lib/risk-gates.ts#L138)

| Rule | Value | Line |
|---|---|---|
| Max adds | 2 | [L140](src/lib/risk-gates.ts#L140) |
| Add #1 trigger | `entryPrice + 0.5 × ATR` | [L142](src/lib/risk-gates.ts#L142) |
| Add #2 trigger | `entryPrice + 1.0 × ATR` | [L142](src/lib/risk-gates.ts#L142) |
| Trigger comparison | `currentPrice >= triggerPrice` | `>=` | [L195](src/lib/risk-gates.ts#L195) |
| Fallback (no ATR) | `rMultiple < 1.0` → disallowed | strict `<` | [L214](src/lib/risk-gates.ts#L214) |
| Fallback (no ATR) | `rMultiple >= 1.0` → allowed | `>=` | [L222](src/lib/risk-gates.ts#L222) |

Backtest config (separate, not used in live): `maxUnits=4, addIntervalAtr=0.5` ([L147–150](src/lib/risk-gates.ts#L147)).

---

## B) REGIME — Market Regime Detection

### B.1 Primary Regime: detectRegime()

**Source:** [regime-detector.ts:detectRegime](src/lib/regime-detector.ts#L24)

**Inputs:** `spyPrice, spy200MA, spyAdx, spyPlusDI, spyMinusDI, vixLevel, advanceDeclineRatio`

**CHOP Band** ([L38–40](src/lib/regime-detector.ts#L38)):
```
CHOP_BAND_PCT = 0.02
upperBand = spy200MA × (1 + 0.02)
lowerBand = spy200MA × (1 - 0.02)
inChopBand = spyPrice >= lowerBand && spyPrice <= upperBand
```

**Point scoring:**

| Signal | Bullish condition | Bearish condition | Points | Line |
|---|---|---|---|---|
| SPY vs 200-MA | `spyPrice > spy200MA` | `spyPrice <= spy200MA` (else branch) | ±3 | [L46–51](src/lib/regime-detector.ts#L46) |
| Directional movement | `spyPlusDI > spyMinusDI` | `spyPlusDI <= spyMinusDI` (else branch) | ±2 | [L54–59](src/lib/regime-detector.ts#L54) |
| VIX | `vixLevel < 20` | `vixLevel > 30` | ±1 | [L62–66](src/lib/regime-detector.ts#L62) |
| ADX strength | `spyAdx >= 25` → adds reason only | — | 0 (info only) | [L69–71](src/lib/regime-detector.ts#L69) |
| Advance/Decline | `advanceDeclineRatio > 1.2` | `advanceDeclineRatio < 0.8` | ±1 | [L74–79](src/lib/regime-detector.ts#L74) |

**Maximum possible:** bullish=7, bearish=7.

**Decision logic** ([L84–96](src/lib/regime-detector.ts#L84)):
```
if (inChopBand) → SIDEWAYS, confidence = 0.5     // CHOP overrides everything
else if (bullishPoints >= 5) → BULLISH
else if (bearishPoints >= 5) → BEARISH
else → SIDEWAYS, confidence = 0.5
```

**Lookback window:** None in this function. All inputs are point-in-time values passed by caller.

**Smoothing:** None in this function. Raw point-in-time scoring.

### B.2 Regime Stability Filter

**Source:** [regime-detector.ts:checkRegimeStability](src/lib/regime-detector.ts#L111)

```
consecutiveDays: count of most recent consecutive days matching currentRegime
isStable = consecutiveDays >= 3
```

| Rule | Comparison | Threshold | Line |
|---|---|---|---|
| Stability requirement | `consecutiveDays >= 3` | `>=` 3 days | [L126](src/lib/regime-detector.ts#L126) |
| Unstable output | Returns `'CHOP'` as currentRegime | | [L130](src/lib/regime-detector.ts#L130) |

History is sorted most-recent-first ([L116](src/lib/regime-detector.ts#L116)). Counts starts at 1 (current day included). Breaks on first mismatch.

### B.3 Dual Benchmark Regime (SPY + VWRL)

**Source:** [regime-detector.ts:detectDualRegime](src/lib/regime-detector.ts#L144)

CHOP detection per benchmark ([L149–152](src/lib/regime-detector.ts#L149)):
```
spyBand = spyMa200 × 0.02
vwrlBand = vwrlMa200 × 0.02
spyInChop = |spyPrice − spyMa200| <= spyBand
vwrlInChop = |vwrlPrice − vwrlMa200| <= vwrlBand
```

Per-benchmark regime:
```
inChop → SIDEWAYS
price > ma200 → BULLISH
price <= ma200 → BEARISH
```

Combined logic ([L161–168](src/lib/regime-detector.ts#L161)):
```
both BULLISH → BULLISH
either BEARISH → BEARISH
else → SIDEWAYS
```

### B.4 canBuy()

**Source:** [regime-detector.ts:canBuy](src/lib/regime-detector.ts#L181)

```
return regime === 'BULLISH'
```

### B.5 getMarketRegime() — SEPARATE IMPLEMENTATION

**Source:** [market-data.ts:getMarketRegime](src/lib/market-data.ts#L534)

This is the function actually called by the positions API pre-trade gate and scan engine. It is **different** from `detectRegime()`.

```
spyData = getDailyPrices('SPY', 'full')
if (spyData.length < 200) return 'BULLISH'      // L537: insufficient data fallback
spyPrice = spyData[0].close                      // L539: newest bar
spyMa200 = calculateMA(closes, 200)              // L541: SMA(200)
spyMa50 = calculateMA(closes, 50)                // L542: SMA(50)

if (spyPrice > spyMa200 && spyMa50 > spyMa200) return 'BULLISH'   // L544
if (spyPrice < spyMa200 && spyMa50 < spyMa200) return 'BEARISH'   // L545
return 'SIDEWAYS'                                                   // L546
```

| Rule | Comparison | Line |
|---|---|---|
| BULLISH | `spyPrice > spyMa200 AND spyMa50 > spyMa200` | [L544](src/lib/market-data.ts#L544) |
| BEARISH | `spyPrice < spyMa200 AND spyMa50 < spyMa200` | [L545](src/lib/market-data.ts#L545) |
| SIDEWAYS | else (any mixed condition) | [L546](src/lib/market-data.ts#L546) |
| Fallback on error | `return 'BULLISH'` | [L548](src/lib/market-data.ts#L548) |

**Differences from detectRegime():**
- No CHOP band
- No VIX input
- No DI input
- No A/D ratio
- No point scoring
- Adds 50-day MA condition
- Catch block defaults to BULLISH
- Insufficient data (<200 bars) defaults to BULLISH

---

## C) STOPS — Initial, Trailing, Tightening, Rounding

### C.1 Initial Stop (in scan)

**Source:** [scan-engine.ts:runFullScan](src/lib/scan-engine.ts#L226)

```
stopPrice = entryTrigger − ATR × ATR_STOP_MULTIPLIER
```

Where `ATR_STOP_MULTIPLIER = 1.5` ([types/index.ts L83](src/types/index.ts#L83)).

In `calculateProtectionStop` for level INITIAL ([stop-manager.ts L43](src/lib/stop-manager.ts#L43)):
```
stop = entryPrice − initialRisk
```
(initialRisk is pre-computed as `entryPrice − stopPrice`, so this is equivalent.)

### C.2 Protection Level Thresholds

**Source:** [stop-manager.ts:getProtectionLevel](src/lib/stop-manager.ts#L22)

R-multiple = `(currentPrice − entryPrice) / initialRisk`

| Level | Threshold | Stop Formula | Line |
|---|---|---|---|
| LOCK_1R_TRAIL | `rMultiple >= 3.0` | `max(entry + 1.0 × initialRisk, currentPrice − 2 × ATR)` | [L23](src/lib/stop-manager.ts#L23), [L49–53](src/lib/stop-manager.ts#L49) |
| LOCK_08R | `rMultiple >= 2.5` | `entry + 0.5 × initialRisk` | [L24](src/lib/stop-manager.ts#L24), [L47](src/lib/stop-manager.ts#L47) |
| BREAKEVEN | `rMultiple >= 1.5` | `entry` | [L25](src/lib/stop-manager.ts#L25), [L45](src/lib/stop-manager.ts#L45) |
| INITIAL | else | `entry − initialRisk` | [L26](src/lib/stop-manager.ts#L26), [L43](src/lib/stop-manager.ts#L43) |

Evaluated top-down. First match wins.

### C.3 Stop Recommendation Logic

**Source:** [stop-manager.ts:calculateStopRecommendation](src/lib/stop-manager.ts#L65)

```
rMultiple = (currentPrice − entryPrice) / initialRisk         // L82
recommendedLevel = getProtectionLevel(rMultiple)               // L83
```

Rules enforced:
1. `initialRisk <= 0` → return null ([L81](src/lib/stop-manager.ts#L81))
2. Only upgrade protection, never downgrade: `recommendedIdx <= currentIdx` → return null ([L89](src/lib/stop-manager.ts#L89))
3. New stop must exceed current stop: `newStop <= currentStop` → return null ([L94](src/lib/stop-manager.ts#L94))

Level ordering: `['INITIAL', 'BREAKEVEN', 'LOCK_08R', 'LOCK_1R_TRAIL']` ([L86](src/lib/stop-manager.ts#L86))

### C.4 Monotonic Enforcement (updateStopLoss)

**Source:** [stop-manager.ts:updateStopLoss](src/lib/stop-manager.ts#L108)

| Check | Comparison | Line |
|---|---|---|
| Position exists | `!position` → throw | [L115](src/lib/stop-manager.ts#L115) |
| Position not closed | `status === 'CLOSED'` → throw | [L119](src/lib/stop-manager.ts#L119) |
| Monotonic rule | `newStop < position.currentStop` → throw | [L123](src/lib/stop-manager.ts#L123) |
| No-op check | `newStop === position.currentStop` → return | [L129](src/lib/stop-manager.ts#L129) |

After write, re-derives level ([L131–133](src/lib/stop-manager.ts#L131)):
```
rMultiple = (newStop − entryPrice) / initialRisk     // NOTE: uses newStop, not currentPrice
newLevel = getProtectionLevel(rMultiple)
```

### C.5 Trailing ATR Stop

**Source:** [stop-manager.ts:calculateTrailingATRStop](src/lib/stop-manager.ts#L232)

**Parameters:** `ticker, entryPrice, entryDate, currentStop, atrMultiplier = 2.0`

**ATR formula used (inline rolling):** [L271–280](src/lib/stop-manager.ts#L271)
```
TR = max(high − low, |high − prevClose|, |low − prevClose|)
ATR = SMA of last 14 TRs  (simple arithmetic mean)
```
This is **SMA-based ATR**, not Wilder's exponential smoothing. The slice is `i-14` to `i+1` (15 elements), but iterates `j=1..14` producing 14 TR values. Sum / 14.

**Trailing stop formula** ([L287](src/lib/stop-manager.ts#L287)):
```
candidateStop = highestClose − atrMultiplier × ATR
```
Where `highestClose` = highest close since entry, tracked bar-by-bar.

**Monotonic ratchet** ([L290](src/lib/stop-manager.ts#L290)):
```
if (candidateStop > trailingStop) → trailingStop = candidateStop
```

**Rounding** ([L296](src/lib/stop-manager.ts#L296)):
```
trailingStop = Math.round(trailingStop * 100) / 100    // 2 decimal places
```

**Should-update check** ([L298](src/lib/stop-manager.ts#L298)):
```
shouldUpdate = trailingStop > currentStop
```

**Data requirement** ([L249](src/lib/stop-manager.ts#L249)):
```
bars.length < 20 → return null
```

**Entry date handling** ([L255](src/lib/stop-manager.ts#L255)):
```
entryDateStr = entryDate.toISOString().split('T')[0]
entryIdx = chronological.findIndex(b => b.date >= entryDateStr)    // >= comparison
```

### C.6 ATR in market-data.ts (calculateATR)

**Source:** [market-data.ts:calculateATR](src/lib/market-data.ts#L186)

```
if (data.length < period + 1) return 0
```

Data is sorted newest-first. Iterates `i = 1 to period`:
```
TR = max(data[i-1].high − data[i-1].low, |data[i-1].high − data[i].close|, |data[i-1].low − data[i].close|)
```
ATR = sum(TRs) / period ([L200](src/lib/market-data.ts#L200)).

This is also **SMA-based ATR** (simple mean of last `period` TRs). Not Wilder's smoothing.

Note: `data[i-1]` is newer, `data[i]` is older (newest-first ordering). So prevClose = `data[i].close` (the prior bar).

### C.7 ADX in market-data.ts (calculateADX)

**Source:** [market-data.ts:calculateADX](src/lib/market-data.ts#L204)

Uses **Wilder's smoothing** for DM/TR/ADX:
```
smoothPlusDM = smoothPlusDM − smoothPlusDM/period + plusDMs[i]    // L247
adx = (adx × (period − 1) + dxValues[i]) / period                // L269
```

Insufficent data fallback ([L209](src/lib/market-data.ts#L209)):
```
data.length < period * 2 + 1 → return { adx: 20, plusDI: 25, minusDI: 20 }
```

### C.8 sync-stops.ts Protection Level (Inline)

**Source:** [prisma/sync-stops.ts](prisma/sync-stops.ts#L104)

```
initialRisk = matched.initialRisk || (matched.entryPrice - newStop)     // L103
rMultiple = (newStop - matched.entryPrice + initialRisk) / initialRisk  // L106
```

Thresholds: same values (≥3.0, ≥2.5, ≥1.5) but applied to a **different** R-multiple formula than `stop-manager.ts:getProtectionLevel`.

The formula `(newStop − entry + initialRisk) / initialRisk` simplifies to `1 + (newStop − entry) / initialRisk`. This means when `newStop = entry` (breakeven), this formula yields R=1.0's, not 0.0 as in `getProtectionLevel`. The thresholds are shifted by +1R relative to the central stop-manager function.

### C.9 Tightening Logic

There is no explicit CHOP-tightening function in `stop-manager.ts`. The only tightening mechanism is the protection level upgrade ladder (C.2) which raises stops based on R-multiple thresholds. The LOCK_1R_TRAIL level includes a trailing component via `currentPrice − 2 × ATR`.

There is no separate "CHOP tightening to 1.5×ATR" function found in the stop manager. The trailing stop ([C.5](#c5-trailing-atr-stop)) always uses `2.0×ATR`.

### C.10 Rounding Logic

Only one rounding rule found:
- Trailing ATR stop: `Math.round(trailingStop × 100) / 100` — rounds to 2 decimal places ([stop-manager.ts L296](src/lib/stop-manager.ts#L296))
- Protection stop (`calculateProtectionStop`): No rounding applied.
- `updateStopLoss`: No rounding applied.
- `sync-stops.ts`: No rounding applied to the stop value itself.

---

## D) POSITION SIZING — Risk per Trade, Stop Distance, Open Risk

### D.1 Core Sizing Formula

**Source:** [position-sizer.ts:calculatePositionSize](src/lib/position-sizer.ts#L20)

**Input validation** ([L23–36](src/lib/position-sizer.ts#L23)):
```
equity <= 0 → throw
entryPrice <= 0 → throw
stopPrice <= 0 → throw
stopPrice >= entryPrice → throw    (longs only)
```

**Risk per share** ([L40](src/lib/position-sizer.ts#L40)):
```
riskPerShare = (entryPrice − stopPrice) × fxToGbp
```

**Risk budget** ([L41–42](src/lib/position-sizer.ts#L41)):
```
riskPercent = customRiskPercent ?? profile.riskPerTrade
riskCashRaw = equity × (riskPercent / 100)
riskCash = riskCashRaw
```

**Cash cap/floor** ([L44–48](src/lib/position-sizer.ts#L44)):
```
if (profile.risk_cash_cap !== undefined)   → riskCash = min(riskCash, risk_cash_cap)
if (profile.risk_cash_floor !== undefined) → riskCash = max(riskCash, risk_cash_floor)
```

Currently only AGGRESSIVE has `risk_cash_cap = 10` ([types/index.ts L50](src/types/index.ts#L50)). No profile has `risk_cash_floor`.

**Shares** ([L51](src/lib/position-sizer.ts#L51)):
```
shares = floor(riskCash / riskPerShare)       // always rounds DOWN
```

### D.2 Position Size Cap Enforcement

**Source:** [position-sizer.ts L54–61](src/lib/position-sizer.ts#L54)

Only applies if `shares > 0 && sleeve` is provided:
```
cap = getProfileCaps(riskProfile).positionSizeCaps[sleeve] ?? POSITION_SIZE_CAPS.CORE
maxCost = equity × cap
totalCostInGbp = shares × entryPrice × fxToGbp
if (totalCostInGbp > maxCost) → shares = floor(maxCost / (entryPrice × fxToGbp))
```

### D.3 Per-Position Max Loss Guard

**Source:** [position-sizer.ts L64–68](src/lib/position-sizer.ts#L64)

```
perPositionMaxLossPct = profile.per_position_max_loss_pct ?? riskPercent
perPositionMaxLossAmount = equity × (perPositionMaxLossPct / 100)
if (riskPerShare × shares > perPositionMaxLossAmount) → shares = floor(perPositionMaxLossAmount / riskPerShare)
```

Currently no profile defines `per_position_max_loss_pct`, so it falls back to `riskPercent` (same as risk per trade). This guard is therefore redundant unless `risk_cash_cap` or `risk_cash_floor` altered `riskCash`.

### D.4 Output Calculations

**Source:** [position-sizer.ts L80–87](src/lib/position-sizer.ts#L80)

```
totalCost = shares × entryPrice × fxToGbp
actualRiskDollars = shares × riskPerShare
actualRiskPercent = (actualRiskDollars / equity) × 100
```

### D.5 FX Conversion

**Source:** [position-sizer.ts L21](src/lib/position-sizer.ts#L21)

`fxToGbp` defaults to `1.0` if not provided. When provided by scan-engine:

[scan-engine.ts:getFxToGbp L184–192](src/lib/scan-engine.ts#L184):
```
isUk (ticker.endsWith('.L') or T212 lowercase-l pattern) or GBX or GBp → 0.01
GBP → 1
else → getFXRate(currency, 'GBP')
```

### D.6 Open Risk Calculation (risk API)

**Source:** [api/risk/route.ts L65](src/app/api/risk/route.ts#L65)

Per position:
```
riskDollars = Math.max(0, (currentPriceGbp − currentStopGbp) × shares)
```

Fed into `getRiskBudget()` ([risk-gates.ts L237](src/lib/risk-gates.ts#L237)):
```
totalRisk = Σ max(0, riskDollars ?? (currentPrice − currentStop) × shares)    // ex-HEDGE
usedRiskPercent = (totalRisk / equity) × 100
```

### D.7 R-Multiple Calculation

**Source:** [position-sizer.ts:calculateRMultiple](src/lib/position-sizer.ts#L109)

```
if (initialRisk === 0) return 0
return (currentPrice − entryPrice) / initialRisk
```

### D.8 Risk per Trade by Profile

| Profile | riskPerTrade | risk_cash_cap | risk_cash_floor | per_position_max_loss_pct | Source |
|---|---|---|---|---|---|
| CONSERVATIVE | 0.75% | — | — | — | [types/index.ts L28](src/types/index.ts#L28) |
| BALANCED | 0.95% | — | — | — | [types/index.ts L34](src/types/index.ts#L34) |
| SMALL_ACCOUNT | 1.5% | — | — | — | [types/index.ts L40](src/types/index.ts#L40) |
| AGGRESSIVE | 2.0% | £10 | — | — | [types/index.ts L46–47](src/types/index.ts#L46) |

---

**END OF PHASE 2 RULES EXTRACT — STOP.**

---

# PHASE 3: WORKED EXAMPLES

**Date:** 2026-02-15
**Scope:** 3 synthetic tickers traced through every formula. Math validated step-by-step. No fixes, no suggestions.

## Common Parameters

| Parameter | Value | Source |
|---|---|---|
| Equity | £10,000 | Synthetic |
| Risk Profile | BALANCED | [types/index.ts L34](src/types/index.ts#L34) |
| riskPerTrade | 0.95% | [types/index.ts L35](src/types/index.ts#L35) |
| maxPositions | 5 | [types/index.ts L36](src/types/index.ts#L36) |
| maxOpenRisk | 5.5% | [types/index.ts L37](src/types/index.ts#L37) |
| ATR_STOP_MULTIPLIER | 1.5 | [types/index.ts L86](src/types/index.ts#L86) |
| POSITION_SIZE_CAP (CORE, BALANCED) | 0.18 (18%) | [types/index.ts L110](src/types/index.ts#L110) |
| CLUSTER_CAP | 0.20 (20%) | [types/index.ts L82](src/types/index.ts#L82) |
| SECTOR_CAP | 0.25 (25%) | [types/index.ts L83](src/types/index.ts#L83) |
| SLEEVE_CAP (CORE) | 0.80 (80%) | [types/index.ts L72](src/types/index.ts#L72) |
| Currency | USD | Synthetic |
| fxToGbp | 0.73 | Synthetic (approx. GBP/USD) |
| Day of week | Wednesday (3) | Synthetic (non-Monday) |
| Existing positions ex-hedge | 1 | Synthetic |
| Existing position risk (GBP) | £45.00 | Synthetic |
| Existing position value (GBP) | £1,200 (ETF sleeve) | Synthetic |

---

## Example 1: SYNTH-A — Clearly READY

### Inputs

| Field | Value |
|---|---|
| price (close) | 200.00 |
| high_20 | 200.00 |
| atr(14) | 4.00 |
| ma200 | 160.00 |
| adx | 40.0 |
| +DI | 35.0 |
| −DI | 10.0 |
| atrSpiking | false |
| efficiency | 60 |
| sleeve | CORE |
| cluster | Energy |
| super_cluster | ENERGY |
| sector | Energy |

### Step 1: Technical Filters [scan-engine.ts L44–68](src/lib/scan-engine.ts#L44)

| Filter | Formula | Result | Pass? |
|---|---|---|---|
| price > ma200 | 200.00 > 160.00 | true | ✓ |
| adx >= 20 | 40.0 >= 20 | true | ✓ |
| +DI > −DI | 35.0 > 10.0 | true | ✓ |
| atrPct < cap | see Step 2; 2.0 < 8 | true | ✓ (CORE uses ATR_VOLATILITY_CAP_ALL = 8) |
| dataQuality | ma200 > 0 ∧ adx > 0 | true | ✓ |

`passesAll = true`

### Step 2: Adaptive Buffer [adaptive-atr-buffer.ts L19–48](src/lib/modules/adaptive-atr-buffer.ts#L19)

**atrPercent computation** [market-data.ts L306](src/lib/market-data.ts#L306):
```
atrPercent = (atr / close) × 100 = (4.00 / 200.00) × 100 = 2.00%
```

**Buffer interpolation** [adaptive-atr-buffer.ts L30–40](src/lib/modules/adaptive-atr-buffer.ts#L30):
```
minATR = 2, maxATR = 6, minBuffer = 0.05, maxBuffer = 0.20
atrPercent (2.00) <= minATR (2) → bufferPercent = maxBuffer = 0.20 (20%)
```

**Entry trigger** [adaptive-atr-buffer.ts L44](src/lib/modules/adaptive-atr-buffer.ts#L44):
```
entryTrigger = high_20 + bufferPercent × atr
             = 200.00 + 0.20 × 4.00
             = 200.00 + 0.80
             = 200.80
```

### Step 3: Classification [scan-engine.ts L80–87](src/lib/scan-engine.ts#L80)

```
distance = ((entryTrigger − price) / price) × 100
         = ((200.80 − 200.00) / 200.00) × 100
         = (0.80 / 200.00) × 100
         = 0.40%
```

| Check | Comparison | Result |
|---|---|---|
| distance <= 2 | 0.40 ≤ 2.0 | **READY** ✓ |

**Post-classification overrides** [scan-engine.ts L240–248](src/lib/scan-engine.ts#L240):
- `atrSpiking = false` → no ATR spike action
- `efficiency (60) >= 30` → no efficiency downgrade

**Final status: READY**

### Step 4: Initial Stop [scan-engine.ts L226](src/lib/scan-engine.ts#L226)

```
stopPrice = entryTrigger − atr × ATR_STOP_MULTIPLIER
          = 200.80 − 4.00 × 1.5
          = 200.80 − 6.00
          = 194.80
```

```
riskPerShare_local = entryTrigger − stopPrice = 200.80 − 194.80 = 6.00
riskPerShare_gbp   = 6.00 × 0.73 = 4.38
```

### Step 5: Anti-Chase Guard [scan-engine.ts L258](src/lib/scan-engine.ts#L258)

**In-scan 0.8 ATR check** (applied every day):
```
extATR = (price − entryTrigger) / atr
       = (200.00 − 200.80) / 4.00
       = −0.80 / 4.00
       = −0.20
```
`−0.20 > 0.8?` → false → falls through to `checkAntiChasingGuard`

**Monday-only guard** [scan-guards.ts L11](src/lib/scan-guards.ts#L11):
```
dayOfWeek (3) !== 1 → return { passed: true, reason: 'Not Monday' }
```

**Anti-chase result: PASSED**

### Step 6: Position Sizing [position-sizer.ts L20–87](src/lib/position-sizer.ts#L20)

**Risk budget:**
```
riskPercent = profile.riskPerTrade = 0.95
riskCashRaw = equity × (riskPercent / 100) = 10000 × 0.0095 = £95.00
riskCash = £95.00       (no cash_cap or floor for BALANCED)
```

**Uncapped shares:**
```
shares = floor(riskCash / riskPerShare_gbp) = floor(95.00 / 4.38) = floor(21.69) = 21
```

**Position size cap check** [position-sizer.ts L54–61](src/lib/position-sizer.ts#L54):
```
cap = getProfileCaps('BALANCED').positionSizeCaps['CORE'] = 0.18
maxCost = equity × cap = 10000 × 0.18 = £1,800.00
totalCostInGbp = 21 × 200.80 × 0.73 = 21 × 146.584 = £3,078.26
```
`3,078.26 > 1,800.00` → **CAP BINDING**
```
shares = floor(maxCost / (entryPrice × fxToGbp))
       = floor(1800 / (200.80 × 0.73))
       = floor(1800 / 146.584)
       = floor(12.28)
       = 12
```

**Per-position max loss guard** [position-sizer.ts L64–68](src/lib/position-sizer.ts#L64):
```
perPositionMaxLossPct = undefined ?? 0.95  → 0.95
perPositionMaxLossAmount = 10000 × 0.0095 = £95.00
actualRisk = 12 × 4.38 = £52.56
52.56 ≤ 95.00 → PASS (no further cap)
```

**Final sizing output:**

| Field | Value |
|---|---|
| shares | 12 |
| totalCost (GBP) | 12 × 200.80 × 0.73 = **£1,759.01** |
| riskDollars (GBP) | 12 × 4.38 = **£52.56** |
| riskPercent | (52.56 / 10000) × 100 = **0.526%** |
| rPerShare (GBP) | 4.38 |

**Observation:** Risk per trade allowed is 0.95% (= £95), but the position size cap (18%) binds first, limiting shares to 12 and actual risk to only 0.526%.

### Step 7: Risk Gates [risk-gates.ts L33–135](src/lib/risk-gates.ts#L33)

Existing portfolio: 1 ETF position, £45 risk, £1,200 value (non-hedge).

| Gate | Formula | Result | Limit | Pass? |
|---|---|---|---|---|
| 1. Total Open Risk | ((45 + 52.56) / 10000) × 100 = **0.98%** | 0.98% | ≤ 5.5% | ✓ |
| 2. Max Positions | 1 existing < 5 max | 2/5 | < 5 | ✓ |
| 3. Sleeve Limit | CORE value / total = 1759.01 / (1200 + 1759.01) = 59.4% | 59.4% | ≤ 80% | ✓ |
| 4. Cluster (Energy) | 1759.01 / 2959.01 = 59.4% | 59.4% | ≤ 20% | **✗ FAIL** |
| 5. Sector (Energy) | 1759.01 / 2959.01 = 59.4% | 59.4% | ≤ 25% | **✗ FAIL** |
| 6. Position Size | 1759.01 / 2959.01 = 59.4% | 59.4% | ≤ 18% | **✗ FAIL** |

**Observation:** Gates 4–6 fail because with only 1 existing (ETF) position and this being the first CORE position, the new position dominates the portfolio. This is expected for a small/early portfolio. The gate formulas use `totalPortfolioValue` (sum of all positions including the new one), not equity. In a portfolio with more positions, concentration would be lower.

**Note on gate denominators:** Gates 3–6 use `totalPortfolioValue` = sum of all existing position values + new position value. Gates 1–2 use equity as denominator. This means concentration gates are relative to portfolio value (which may be << equity in early stages), while risk gates are relative to equity.

### Step 8: Held Position — Stop Progression

Assume SYNTH-A was entered at 200.80 with stop 194.80, shares = 12.
`initialRisk = entryPrice − initialStop = 200.80 − 194.80 = 6.00`

#### Day T+30: Price reaches 215.00

**R-multiple** [stop-manager.ts L82](src/lib/stop-manager.ts#L82):
```
rMultiple = (currentPrice − entryPrice) / initialRisk
          = (215.00 − 200.80) / 6.00
          = 14.20 / 6.00
          = 2.367
```

**Protection level** [stop-manager.ts L22–27](src/lib/stop-manager.ts#L22):
```
2.367 ≥ 3.0?  No
2.367 ≥ 2.5?  No
2.367 ≥ 1.5?  Yes → BREAKEVEN
```

**Protection stop** [stop-manager.ts L45](src/lib/stop-manager.ts#L45):
```
BREAKEVEN → candidateStop = entryPrice = 200.80
```

**Monotonic ratchet** [stop-manager.ts L94](src/lib/stop-manager.ts#L94):
```
newStop = max(currentStop, candidateStop) = max(194.80, 200.80) = 200.80
```

**Updated stop: 200.80** (moved up from initial 194.80)

**Open risk at this point (two definitions):**
- Positions API (entry-based): `(entryPrice − newStop) × shares × fxToGbp = (200.80 − 200.80) × 12 × 0.73 = £0.00`
- Risk API (price-based): `max(0, (215.00 − 200.80) × 12 × 0.73) = max(0, 14.20 × 12 × 0.73) = £124.39`

**Observation:** At BREAKEVEN, the entry-based risk is £0 (correct — you'd break even if stopped out), but the risk API shows £124.39 of "open risk" because it measures current price distance to stop. These are semantically different quantities — one is loss-at-stop, the other is mark-to-market exposure.

#### Day T+60: Price reaches 225.00, ATR(14) = 4.50 (expanded)

**R-multiple:**
```
rMultiple = (225.00 − 200.80) / 6.00 = 24.20 / 6.00 = 4.033
```

**Protection level:**
```
4.033 ≥ 3.0? Yes → LOCK_1R_TRAIL
```

**Protection stop** [stop-manager.ts L37–41](src/lib/stop-manager.ts#L37):
```
LOCK_1R_TRAIL:
  entryPlusOneR = entryPrice + initialRisk = 200.80 + 6.00 = 206.80
  trailingATR   = highestClose − 2 × atr = 225.00 − 2 × 4.50 = 225.00 − 9.00 = 216.00
  candidateStop = max(206.80, 216.00) = 216.00
```

**Monotonic ratchet:**
```
newStop = max(currentStop, candidateStop) = max(200.80, 216.00) = 216.00
```

**Updated stop: 216.00**

**Open risk:**
- Positions API: `(200.80 − 216.00) × 12 × 0.73 → negative → max(0, …) = £0` (profit locked)
- Risk API: `max(0, (225.00 − 216.00) × 12 × 0.73) = max(0, 9.00 × 12 × 0.73) = £78.84`
- As % of equity: `(78.84 / 10000) × 100 = 0.79%`

#### sync-stops.ts R-multiple discrepancy

If `sync-stops.ts` processes this same position with `newStop = 216.00`:
```
rMultiple_syncStops = (newStop − entryPrice + initialRisk) / initialRisk
                    = (216.00 − 200.80 + 6.00) / 6.00
                    = 21.20 / 6.00
                    = 3.533
```

**stop-manager.ts** R-multiple for the same stop (using `updateStopLoss` inline re-derivation at [L131](src/lib/stop-manager.ts#L131)):
```
rMultiple_stopManager = (newStop − entryPrice) / initialRisk
                      = (216.00 − 200.80) / 6.00
                      = 15.20 / 6.00
                      = 2.533
```

| Module | R formula applied to newStop=216.00 | R-multiple | Protection level |
|---|---|---|---|
| stop-manager.ts L131 | (newStop − entry) / initialRisk | 2.533 | LOCK_08R |
| sync-stops.ts L106 | (newStop − entry + initialRisk) / initialRisk | 3.533 | LOCK_1R_TRAIL |

**Observation:** Same stop value (216.00) produces **different protection level classifications** depending on which module evaluates it. The sync-stops formula is shifted +1R, causing it to report a higher protection level than stop-manager's post-update re-derivation.

---

## Example 2: SYNTH-B — Clearly WATCH

### Inputs

| Field | Value |
|---|---|
| price (close) | 100.00 |
| high_20 | 102.50 |
| atr(14) | 2.00 |
| ma200 | 80.00 |
| adx | 25.0 |
| +DI | 30.0 |
| −DI | 18.0 |
| atrSpiking | false |
| efficiency | 45 |
| sleeve | CORE |
| cluster | Technology |
| super_cluster | MEGA_TECH_AI |
| sector | Technology |

### Step 1: Technical Filters

| Filter | Formula | Result | Pass? |
|---|---|---|---|
| price > ma200 | 100.00 > 80.00 | true | ✓ |
| adx >= 20 | 25.0 >= 20 | true | ✓ |
| +DI > −DI | 30.0 > 18.0 | true | ✓ |
| atrPct < 8 | 2.0 < 8 | true | ✓ |
| dataQuality | ma200 > 0 ∧ adx > 0 | true | ✓ |

`passesAll = true`

### Step 2: Adaptive Buffer

**atrPercent:**
```
atrPercent = (2.00 / 100.00) × 100 = 2.00%
```

**Buffer:**
```
atrPercent (2.00) <= minATR (2) → bufferPercent = 0.20 (20%)
```

**Entry trigger:**
```
entryTrigger = 102.50 + 0.20 × 2.00 = 102.50 + 0.40 = 102.90
```

### Step 3: Classification

```
distance = ((102.90 − 100.00) / 100.00) × 100
         = (2.90 / 100.00) × 100
         = 2.90%
```

| Check | Comparison | Result |
|---|---|---|
| distance <= 2 | 2.90 ≤ 2.0 | No |
| distance <= 3 | 2.90 ≤ 3.0 | **WATCH** |

**Post-classification overrides:**
- `atrSpiking = false` → no action
- Status is WATCH, not READY → efficiency downgrade check skipped ([scan-engine.ts L249](src/lib/scan-engine.ts#L249): only applies to READY)

**Final status: WATCH**

### Step 4: Initial Stop

```
stopPrice = 102.90 − 2.00 × 1.5 = 102.90 − 3.00 = 99.90
riskPerShare_local = 102.90 − 99.90 = 3.00
riskPerShare_gbp = 3.00 × 0.73 = 2.19
```

### Step 5: Anti-Chase Guard

```
extATR = (100.00 − 102.90) / 2.00 = −2.90 / 2.00 = −1.45
```
`−1.45 > 0.8?` → false → `checkAntiChasingGuard`
`dayOfWeek (3) !== 1` → passed (not Monday)

### Step 6: Position Sizing

Sizing is computed for non-FAR candidates even when WATCH ([scan-engine.ts L254](src/lib/scan-engine.ts#L254): `passesAllFilters && status !== 'FAR'`).

**Risk budget:**
```
riskCash = 10000 × 0.0095 = £95.00
```

**Uncapped shares:**
```
shares = floor(95.00 / 2.19) = floor(43.38) = 43
totalCostInGbp = 43 × 102.90 × 0.73 = 43 × 75.117 = £3,230.03
```

**Position size cap:**
```
maxCost = 10000 × 0.18 = £1,800.00
3,230.03 > 1,800.00 → CAP BINDING
shares = floor(1800 / 75.117) = floor(23.96) = 23
```

**Per-position max loss:**
```
maxLoss = £95.00
actualRisk = 23 × 2.19 = £50.37
50.37 ≤ 95.00 → PASS
```

**Final sizing output:**

| Field | Value |
|---|---|
| shares | 23 |
| totalCost (GBP) | 23 × 102.90 × 0.73 = **£1,727.69** |
| riskDollars (GBP) | 23 × 2.19 = **£50.37** |
| riskPercent | (50.37 / 10000) × 100 = **0.504%** |

**Observation:** same cap-binding pattern as SYNTH-A. With BALANCED profile and fxToGbp ≈ 0.73, the 18% position size cap consistently binds before the 0.95% risk budget is exhausted for USD-denominated stocks in the $100–200 range.

### Step 7: Risk Gates

Same existing portfolio as SYNTH-A (1 ETF position, £45 risk, £1,200 value).

| Gate | Result | Limit | Pass? |
|---|---|---|---|
| 1. Total Open Risk | (45 + 50.37) / 10000 × 100 = 0.95% | ≤ 5.5% | ✓ |
| 2. Max Positions | 2/5 | < 5 | ✓ |
| 3. Sleeve (CORE) | 1727.69 / 2927.69 = 59.0% | ≤ 80% | ✓ |
| 4. Cluster (Technology) | 1727.69 / 2927.69 = 59.0% | ≤ 20% | ✗ |
| 5. Sector (Technology) | 1727.69 / 2927.69 = 59.0% | ≤ 25% | ✗ |
| 6. Position Size | 1727.69 / 2927.69 = 59.0% | ≤ 18% | ✗ |

Same concentration gate failures as SYNTH-A — structural for a 2-position portfolio.

### Not Entered

SYNTH-B is WATCH status. No held-position analysis needed — the ticker is tracked but not actionable until it reaches READY (distance ≤ 2%).

---

## Example 3: SYNTH-C — Borderline (Distance = 2.00%)

### Inputs

| Field | Value |
|---|---|
| price (close) | 50.00 |
| high_20 | 50.75 |
| atr(14) | 2.00 |
| ma200 | 42.00 |
| adx | 22.0 |
| +DI | 26.0 |
| −DI | 20.0 |
| atrSpiking | false |
| efficiency | 35 |
| sleeve | CORE |
| cluster | Materials |
| super_cluster | MATERIALS |
| sector | Materials |

### Step 1: Technical Filters

| Filter | Formula | Result | Pass? |
|---|---|---|---|
| price > ma200 | 50.00 > 42.00 | true | ✓ |
| adx >= 20 | 22.0 >= 20 | true | ✓ (just above threshold) |
| +DI > −DI | 26.0 > 20.0 | true | ✓ (narrow margin) |
| atrPct < 8 | 4.0 < 8 | true | ✓ |
| dataQuality | ma200 > 0 ∧ adx > 0 | true | ✓ |

`passesAll = true`

### Step 2: Adaptive Buffer

**atrPercent:**
```
atrPercent = (2.00 / 50.00) × 100 = 4.00%
```

**Buffer interpolation** (4.0 is between minATR=2 and maxATR=6):
```
bufferPercent = maxBuffer − ((atrPercent − minATR) / (maxATR − minATR)) × (maxBuffer − minBuffer)
             = 0.20 − ((4.0 − 2) / (6 − 2)) × (0.20 − 0.05)
             = 0.20 − (2 / 4) × 0.15
             = 0.20 − 0.50 × 0.15
             = 0.20 − 0.075
             = 0.125 (12.5%)
```

**Entry trigger:**
```
entryTrigger = 50.75 + 0.125 × 2.00 = 50.75 + 0.25 = 51.00
```

### Step 3: Classification — THE BOUNDARY

```
distance = ((51.00 − 50.00) / 50.00) × 100
         = (1.00 / 50.00) × 100
         = 2.00%
```

| Check | Comparison | Result |
|---|---|---|
| distance <= 2 | 2.00 ≤ 2.0 | **READY** (exactly at boundary) |

The comparison is `<=` ([scan-engine.ts L84](src/lib/scan-engine.ts#L84)), so 2.00% is classified as READY.

**Post-classification overrides:**
- `atrSpiking = false` → no action
- `efficiency (35) >= 30` → no downgrade

**Final status: READY** (but at the knife-edge)

### Step 3a: Sensitivity Analysis

| Price | distance | Status | Delta |
|---|---|---|---|
| 50.01 | ((51.00 − 50.01) / 50.01) × 100 = 1.980% | READY | |
| **50.00** | **2.000%** | **READY** | **← exact boundary** |
| 49.99 | ((51.00 − 49.99) / 49.99) × 100 = 2.020% | WATCH | $0.01 price change |
| 49.90 | ((51.00 − 49.90) / 49.90) × 100 = 2.204% | WATCH | |
| 49.50 | ((51.00 − 49.50) / 49.50) × 100 = 3.030% | FAR | |

**Observation:** A $0.01 price change (50.00 → 49.99) flips SYNTH-C from READY to WATCH. At the 3% WATCH/FAR boundary, $49.50 → $49.49 would flip to FAR (((51.00 − 49.49) / 49.49) × 100 = 3.051%). No hysteresis or debounce mechanism exists in the classification function.

### Step 4: Initial Stop

```
stopPrice = 51.00 − 2.00 × 1.5 = 51.00 − 3.00 = 48.00
riskPerShare_local = 51.00 − 48.00 = 3.00
riskPerShare_gbp = 3.00 × 0.73 = 2.19
```

### Step 5: Anti-Chase Guard

```
extATR = (50.00 − 51.00) / 2.00 = −1.00 / 2.00 = −0.50
```
`−0.50 > 0.8?` → false → Monday check → not Monday → passed

### Step 6: Position Sizing

**Risk budget:**
```
riskCash = 10000 × 0.0095 = £95.00
```

**Uncapped shares:**
```
shares = floor(95.00 / 2.19) = floor(43.38) = 43
totalCostInGbp = 43 × 51.00 × 0.73 = 43 × 37.23 = £1,600.89
```

**Position size cap:**
```
maxCost = 10000 × 0.18 = £1,800.00
1,600.89 ≤ 1,800.00 → NOT BINDING
```

**Per-position max loss:**
```
maxLoss = £95.00
actualRisk = 43 × 2.19 = £94.17
94.17 ≤ 95.00 → PASS (within £0.83 of the limit)
```

**Final sizing output:**

| Field | Value |
|---|---|
| shares | 43 |
| totalCost (GBP) | **£1,600.89** |
| riskDollars (GBP) | **£94.17** |
| riskPercent | (94.17 / 10000) × 100 = **0.942%** |

**Observation:** Unlike SYNTH-A and SYNTH-B, the position size cap does NOT bind here because the stock is cheaper ($51 vs $200/$103). The risk budget is nearly fully utilized (0.942% of the 0.95% target). The per-position max loss guard is also close to binding (£94.17 vs £95.00 limit — only £0.83 margin).

### Step 7: Risk Gates

| Gate | Result | Limit | Pass? |
|---|---|---|---|
| 1. Total Open Risk | (45 + 94.17) / 10000 × 100 = 1.39% | ≤ 5.5% | ✓ |
| 2. Max Positions | 2/5 | < 5 | ✓ |
| 3. Sleeve (CORE) | 1600.89 / 2800.89 = 57.2% | ≤ 80% | ✓ |
| 4. Cluster (Materials) | 1600.89 / 2800.89 = 57.2% | ≤ 20% | ✗ |
| 5. Sector (Materials) | 1600.89 / 2800.89 = 57.2% | ≤ 25% | ✗ |
| 6. Position Size | 1600.89 / 2800.89 = 57.2% | ≤ 18% | ✗ |

### Step 8: Held Position — Stop Progression

Assume SYNTH-C entered at 51.00, stop 48.00, shares = 43, initialRisk = 3.00.

#### Day T+15: Price = 55.50

```
rMultiple = (55.50 − 51.00) / 3.00 = 4.50 / 3.00 = 1.50
```
`1.50 ≥ 1.5` → **BREAKEVEN**
```
candidateStop = entryPrice = 51.00
newStop = max(48.00, 51.00) = 51.00
```

#### Day T+25: Price = 58.50

```
rMultiple = (58.50 − 51.00) / 3.00 = 7.50 / 3.00 = 2.50
```
`2.50 ≥ 2.5` → **LOCK_08R**
```
candidateStop = entry + 0.8 × initialRisk = 51.00 + 0.8 × 3.00 = 51.00 + 2.40 = 53.40
newStop = max(51.00, 53.40) = 53.40
```

#### Day T+30: Price = 60.00, ATR(14) = 2.20

```
rMultiple = (60.00 − 51.00) / 3.00 = 9.00 / 3.00 = 3.00
```
`3.00 ≥ 3.0` → **LOCK_1R_TRAIL**
```
entryPlusOneR = 51.00 + 3.00 = 54.00
trailingATR = highestClose − 2 × atr = 60.00 − 2 × 2.20 = 60.00 − 4.40 = 55.60
candidateStop = max(54.00, 55.60) = 55.60
newStop = max(53.40, 55.60) = 55.60
```

#### sync-stops.ts comparison at Day T+30 (newStop = 55.60)

| Module | Formula | R value | Protection Level |
|---|---|---|---|
| stop-manager.ts L131 | (55.60 − 51.00) / 3.00 | 1.533 | BREAKEVEN |
| sync-stops.ts L106 | (55.60 − 51.00 + 3.00) / 3.00 | 2.533 | LOCK_08R |

Actual protection level in effect (from `calculateStopRecommendation`): **LOCK_1R_TRAIL** (based on current price R = 3.0).
Post-update re-derivation by `updateStopLoss`(L131) using stop-based R: **BREAKEVEN** (R = 1.533).
sync-stops classification: **LOCK_08R** (R = 2.533).

Three modules, three different answers for the same stop position.

---

## Cross-Example Summary

### Sizing Comparison

| Ticker | Price | Risk/Share (GBP) | Uncapped Shares | Cap-Limited Shares | Final Risk% | Cap Binding? |
|---|---|---|---|---|---|---|
| SYNTH-A | $200.80 | £4.38 | 21 | 12 | 0.526% | **Yes** (18% position cap) |
| SYNTH-B | $102.90 | £2.19 | 43 | 23 | 0.504% | **Yes** (18% position cap) |
| SYNTH-C | $51.00 | £2.19 | 43 | 43 | 0.942% | **No** (risk budget near-binding) |

**Pattern:** For BALANCED profile with £10,000 equity and fxToGbp = 0.73, the 18% position size cap binds for stocks priced above ~$69 (threshold = maxCost / (shares × fxToGbp) where risk budget would produce shares that exceed the cap). Below that price, the 0.95% risk budget is the binding constraint.

### Classification Sensitivity

| Ticker | Distance | Status | Margin to Next Threshold |
|---|---|---|---|
| SYNTH-A | 0.40% | READY | 1.60% to WATCH |
| SYNTH-B | 2.90% | WATCH | 0.10% to FAR |
| SYNTH-C | 2.00% | READY | 0.00% to WATCH (exact boundary) |

### Consistency Findings (Extracted, Not Fixed)

| # | Finding | References |
|---|---|---|
| 1 | **R-multiple formula mismatch** between stop-manager.ts and sync-stops.ts produces different protection level classifications for the same stop value. Demonstrated: stop=216.00 yields LOCK_08R vs LOCK_1R_TRAIL depending on module. | [stop-manager.ts L131](src/lib/stop-manager.ts#L131), [sync-stops.ts L106](prisma/sync-stops.ts#L106) |
| 2 | **Triple R-derivation disagreement**: `calculateStopRecommendation` uses (price−entry)/R, `updateStopLoss` re-derives using (stop−entry)/R, and `sync-stops` uses (stop−entry+R)/R. All three can produce different protection levels for the same position state. | [stop-manager.ts L82](src/lib/stop-manager.ts#L82), [L131](src/lib/stop-manager.ts#L131), [sync-stops.ts L106](prisma/sync-stops.ts#L106) |
| 3 | **riskGBP semantic difference**: positions API uses (entry−stop)×shares (loss-at-stop), risk API uses max(0, (price−stop)×shares) (mark-to-market exposure). At breakeven stop, these yield £0 vs £124.39 respectively. | [positions/route.ts](src/app/api/positions/route.ts), [risk/route.ts L65](src/app/api/risk/route.ts#L65) |
| 4 | **No classification hysteresis**: a $0.01 price change can flip status between READY/WATCH or WATCH/FAR with no debounce. | [scan-engine.ts L84](src/lib/scan-engine.ts#L84) |
| 5 | **Position size cap dominant in mid-price stocks**: the 18% cap consistently binds before the 0.95% risk budget, producing actual risk utilization of only ~0.5% instead of the target 0.95%. | [position-sizer.ts L54](src/lib/position-sizer.ts#L54), [types/index.ts L110](src/types/index.ts#L110) |
| 6 | **Concentration gates structurally fail in small portfolios**: gates 4–6 use portfolio value as denominator, not equity. With 1–2 positions, any new position exceeds 20% cluster/18% position caps by construction. | [risk-gates.ts L88–131](src/lib/risk-gates.ts#L88) |

---

**END OF PHASE 3 WORKED EXAMPLES — STOP.**

---

# PHASE 4: FINDINGS TABLE

**Date:** 2026-02-15
**Scope:** Provable issues only. Each backed by exact file:function:line evidence.
**Rules:** Minimal safe corrections. No refactoring. No redesign. No optimisation.

---

## F-001 · R-Multiple Formula Mismatch Between sync-stops and stop-manager

| Field | Detail |
|---|---|
| **Severity** | **P0 — Logic Error (Silent Data Corruption)** |
| **Area** | Stop Management / Protection Levels |
| **Description** | `sync-stops.ts` uses a different R-multiple formula than `stop-manager.ts`. sync-stops computes `(newStop − entryPrice + initialRisk) / initialRisk`, which is algebraically `1 + (newStop − entryPrice) / initialRisk` — shifted +1R versus stop-manager's `(newStop − entryPrice) / initialRisk`. Same stop value → different protection level classification. |
| **Evidence** | **stop-manager.ts**: `updateStopLoss` re-derives R at [L139](src/lib/stop-manager.ts#L139): `(newStop - position.entryPrice) / position.initialRisk`. **sync-stops.ts** [L106](prisma/sync-stops.ts#L106): `(newStop - matched.entryPrice + initialRisk) / initialRisk`. |
| **Impact** | After CSV import via `sync-stops`, `stopHistory` records are tagged with inflated protection levels. Example: stop = entry + 1.0R → stop-manager says R=1.0 (INITIAL), sync-stops says R=2.0 (BREAKEVEN). A stop at entry+2.0R → stop-manager: R=2.0 (BREAKEVEN), sync-stops: R=3.0 (LOCK_1R_TRAIL). Dashboard and history show wrong protection labels for CSV-imported stops. |
| **Minimal Fix** | In [prisma/sync-stops.ts L106](prisma/sync-stops.ts#L106), change: `const rMultiple = (newStop - matched.entryPrice + initialRisk) / initialRisk;` → `const rMultiple = (newStop - matched.entryPrice) / initialRisk;` |
| **Validate** | 1. Create position: entry=100, initialRisk=10, currentStop=90. 2. CSV-import activeStop=115. 3. Check `stopHistory` record — level should be BREAKEVEN (R=1.5), not LOCK_08R (old formula yields R=2.5). 4. Compare with `getProtectionLevel((115-100)/10)` = `getProtectionLevel(1.5)` = BREAKEVEN. |

---

## F-002 · sync-stops initialRisk Fallback Uses Falsy Check on Required Field

| Field | Detail |
|---|---|
| **Severity** | **P2 — Defensive Error** |
| **Area** | Stop Management / CSV Import |
| **Description** | `sync-stops.ts` uses `matched.initialRisk \|\| (matched.entryPrice - newStop)` to compute initialRisk. The `\|\|` operator treats `0` as falsy. Since `initialRisk` is a non-optional `Float` in the schema ([schema.prisma L70](prisma/schema.prisma#L70)), it cannot be null but could theoretically be `0.0`. If `initialRisk = 0`, the fallback `entryPrice - newStop` is used — which is negative when stop > entry, producing a negative denominator that silently bypasses the R-multiple calculation (falls to INITIAL). |
| **Evidence** | [sync-stops.ts L103](prisma/sync-stops.ts#L103): `const initialRisk = matched.initialRisk \|\| (matched.entryPrice - newStop);` |
| **Impact** | If a position somehow has `initialRisk = 0` in the database, the fallback formula produces incorrect risk values. The `if (initialRisk > 0)` guard at [L105](prisma/sync-stops.ts#L105) prevents division-by-zero but misclassifies the protection level as INITIAL regardless of actual profit. Low probability in normal operation since positions are created with non-zero initial risk. |
| **Minimal Fix** | Change `\|\|` to `??` (nullish coalescing) so that `0` is preserved: `const initialRisk = matched.initialRisk ?? (matched.entryPrice - newStop);`. Then add a guard: `if (!initialRisk \|\| initialRisk <= 0) continue;` |
| **Validate** | Unit test: mock position with `initialRisk = 0`, `entryPrice = 100`, `newStop = 110`. With `\|\|`: fallback = 100 − 110 = −10, guard blocks (correct by accident). With `??`: initialRisk = 0, guard blocks (correct by design). Confirm no change in behaviour for normal cases where `initialRisk > 0`. |

---

## F-003 · getMarketRegime Defaults to BULLISH on Error and Insufficient Data

| Field | Detail |
|---|---|
| **Severity** | **P1 — Safety Gate Failure** |
| **Area** | Regime Detection / Pre-Trade Gate |
| **Description** | `getMarketRegime()` returns `'BULLISH'` in two failure cases: (a) when Yahoo Finance returns fewer than 200 bars ([L537](src/lib/market-data.ts#L537)), and (b) on any exception ([L548](src/lib/market-data.ts#L548)). Since this function is the regime gate for both the scan engine ([scan-engine.ts L151](src/lib/scan-engine.ts#L151)) and the pre-trade POST check ([positions/route.ts L195](src/app/api/positions/route.ts#L195)), a data outage causes the system to silently permit entries in any market condition. |
| **Evidence** | [market-data.ts L534–549](src/lib/market-data.ts#L534): `if (spyData.length < 200) return 'BULLISH';` and `catch { return 'BULLISH'; }`. Callers: [scan-engine.ts L151](src/lib/scan-engine.ts#L151), [positions/route.ts L195](src/app/api/positions/route.ts#L195). |
| **Impact** | During Yahoo Finance outage or rate-limiting, the BULLISH default silently bypasses the regime safety gate. New entries could be opened during a BEARISH or SIDEWAYS regime. This is the opposite of a safe default. |
| **Minimal Fix** | Change both fallbacks to return `'SIDEWAYS'` instead of `'BULLISH'`. SIDEWAYS blocks new entries via the pre-trade gate (`regime !== 'BULLISH'` check at [positions/route.ts L196](src/app/api/positions/route.ts#L196)), providing a fail-safe. |
| **Validate** | 1. Mock `getDailyPrices('SPY')` to throw. 2. Call `getMarketRegime()` → should return `'SIDEWAYS'`. 3. Attempt POST to `/api/positions` → should be rejected with `REGIME_BLOCKED`. 4. Repeat with `getDailyPrices` returning < 200 bars → same result. |

---

## F-004 · Positions API riskGBP Uses Entry-Based Risk (Not Mark-to-Market)

| Field | Detail |
|---|---|
| **Severity** | **P2 — Semantic Inconsistency** |
| **Area** | Risk Reporting / API |
| **Description** | The positions API computes `riskGBP = (entryPriceGBP - stopGBP) × shares` — measuring loss-at-stop relative to **entry price**. The risk API and nightly cron use `max(0, (currentPriceGBP - stopGBP) × shares)` — measuring loss-at-stop relative to **current price**. These answer different questions: "how much do I lose vs my cost basis?" vs "how much can I lose from here?". The field name `riskGBP` does not disambiguate. |
| **Evidence** | Positions API [L131](src/app/api/positions/route.ts#L131): `(entryPriceGBP - stopGBP) * p.shares`. Risk API [L77](src/app/api/risk/route.ts#L77): `Math.max(0, (currentPriceGbp - currentStopGbp) * p.shares)`. Nightly [L347](src/cron/nightly.ts#L347): `Math.max(0, (gbpPrice - currentStopGbp) * p.shares)`. |
| **Impact** | For a position at BREAKEVEN stop (stop = entry), positions API shows `riskGBP = 0` (correct for cost-basis risk), but if price has moved to +3R, the risk API shows the full mark-to-market gap as "open risk". Neither is wrong — they measure different things — but consumers of the API can misinterpret. More critically: positions API can show **negative** riskGBP when stop > entry (profit locked), which is confusing. Risk API uses `Math.max(0, ...)` to floor at zero; positions API does not. |
| **Minimal Fix** | Add `Math.max(0, ...)` to the positions API calculation at [L131](src/app/api/positions/route.ts#L131): `const riskGBP = Math.max(0, (entryPriceGBP - stopGBP) * p.shares);`. This prevents negative risk display. The semantic difference (entry-based vs price-based) is intentional by design and should be documented, not changed. |
| **Validate** | 1. Create position: entry=100, stop=110 (above entry). 2. GET `/api/positions` → `riskGBP` should be `0` (not negative). 3. Verify risk API still shows mark-to-market exposure correctly. |

---

## F-005 · updateStopLoss Re-Derives Protection Level from Stop-Based R (Inconsistent with Price-Based R)

| Field | Detail |
|---|---|
| **Severity** | **P1 — Logic Inconsistency (Persisted Wrong Label)** |
| **Area** | Stop Management |
| **Description** | `calculateStopRecommendation` uses price-based R to decide protection level: `R = (currentPrice − entry) / initialRisk`. But `updateStopLoss` re-derives the level after writing using stop-based R: `R = (newStop − entry) / initialRisk`. These diverge whenever stop ≠ entry + R×initialRisk — which is always the case for LOCK_1R_TRAIL (trailing ATR formula). The level written to `stopHistory` disagrees with the level that triggered the stop move. |
| **Evidence** | `calculateStopRecommendation` [L82](src/lib/stop-manager.ts#L82): `(currentPrice - entryPrice) / initialRisk`. `updateStopLoss` [L139](src/lib/stop-manager.ts#L139): `(newStop - position.entryPrice) / position.initialRisk`. Example: price=225, entry=200, risk=6 → recommendation R=4.17 → LOCK_1R_TRAIL. Stop set to 216 (trailing ATR). updateStopLoss re-derives: (216−200)/6 = 2.67 → LOCK_08R. stopHistory records LOCK_08R, not LOCK_1R_TRAIL. |
| **Impact** | `stopHistory` records and the `protectionLevel` field on the position contain wrong values after LOCK_1R_TRAIL stops are applied. Dashboard displays stale/wrong protection level badges. Does not affect actual stop price enforcement (monotonic rule is correct). |
| **Minimal Fix** | Modify `updateStopLoss` to accept an optional `level` parameter. When provided (by `calculateStopRecommendation` or nightly cron), use it directly instead of re-deriving. Fallback to re-derivation when not provided (manual stop updates). At [L108](src/lib/stop-manager.ts#L108), add `level?: ProtectionLevel` to signature. At [L139–141](src/lib/stop-manager.ts#L139), change to: `const newLevel = level ?? getProtectionLevel(rMultiple);` |
| **Validate** | 1. Position: entry=200, risk=6, current stop=200. 2. Price reaches 225, ATR=4.50. 3. `calculateStopRecommendation` returns LOCK_1R_TRAIL, newStop=216. 4. After `updateStopLoss(id, 216, ..., 'LOCK_1R_TRAIL')`, check `protectionLevel` on position = LOCK_1R_TRAIL (not LOCK_08R). 5. Check `stopHistory` record also shows LOCK_1R_TRAIL. |

---

## F-006 · Risk Gate Concentration Denominators Use Portfolio Value, Not Equity

| Field | Detail |
|---|---|
| **Severity** | **P3 — Design Observation (Documented, Not a Bug)** |
| **Area** | Risk Gates |
| **Description** | Gates 3–6 (sleeve, cluster, sector, position size) compute percentages using `totalPortfolioValue` (sum of existing positions + new position) as denominator. Gates 1–2 (total open risk, max positions) use `equity`. In early-stage portfolios with 0–2 positions, `totalPortfolioValue << equity`, causing concentration percentages to be artificially inflated (e.g. first CORE position = 100% of portfolio by value). |
| **Evidence** | [risk-gates.ts L84](src/lib/risk-gates.ts#L84): `const totalPortfolioValue = existingPositions.reduce((sum, p) => sum + p.value, 0) + newPosition.value;` Used at [L87](src/lib/risk-gates.ts#L87) (sleeve), [L97](src/lib/risk-gates.ts#L97) (cluster), [L112](src/lib/risk-gates.ts#L112) (sector), [L123](src/lib/risk-gates.ts#L123) (position size). Gates 1–2 use `equity` at [L61](src/lib/risk-gates.ts#L61) and [L69](src/lib/risk-gates.ts#L69). |
| **Impact** | All BALANCED accounts with < 3 positions will always fail cluster (20%) and position size (18%) gates because any single position exceeds these thresholds by construction. The scan still shows the candidates but marks them as failing risk gates. If these gates are enforced as hard blocks, no positions can be opened until the portfolio has sufficient diversification — a chicken-and-egg problem. In practice, the snapshot CSV bypass means positions do get opened, and the gates only prevent API-based entries. |
| **Minimal Fix** | This is a **design decision**, not a bug. Two options: (a) Use `Math.max(totalPortfolioValue, equity)` as denominator to prevent < 100% scenarios, or (b) skip concentration gates when `positionCount < 3`. Either changes gate semantics. Document the current behaviour as intentional if no change is desired. |
| **Validate** | 1. Set equity=10000, 0 existing positions. 2. Add candidate with value=1500. 3. `totalPortfolioValue = 1500`, position size% = 100%. Verify gate fails. 4. If fix (a) applied: denominator = max(1500, 10000) = 10000, position size% = 15% → passes 18% cap. |

---

## F-007 · LOCK_08R Enum Name Implies +0.8R but Formula Computes +0.5R

| Field | Detail |
|---|---|
| **Severity** | **P3 — Naming Inconsistency** |
| **Area** | Stop Management / Types |
| **Description** | The enum value `LOCK_08R` suggests the stop locks at entry + 0.8×R. The actual formula locks at entry + 0.5×R. Code and UI label both say "+0.5R" but the enum name says "08R". |
| **Evidence** | Enum: [types/index.ts L152](src/types/index.ts#L152): `'LOCK_08R'`. Formula: [stop-manager.ts L46](src/lib/stop-manager.ts#L46): `entryPrice + 0.5 * initialRisk` with comment "Lock +0.5R above entry". UI label: [types/index.ts L229](src/types/index.ts#L229): `label: 'Lock +0.5R'`. Formula text: [types/index.ts L231](src/types/index.ts#L231): `'Entry + 0.5 × Initial Risk'`. |
| **Impact** | No runtime impact — the formula is correct and consistent everywhere except the enum name. Could confuse developers reading the code. |
| **Minimal Fix** | Rename enum value from `'LOCK_08R'` to `'LOCK_05R'` across all files. This is a search-and-replace across types, stop-manager, sync-stops, and any UI components. Alternatively, leave as-is and add a code comment explaining the naming history. |
| **Validate** | Global search `LOCK_08R` → zero results after rename. All tests pass. Protection level progression still works correctly. |

---

## F-008 · detectRegime() Is Dead Code — Never Called by Any Consumer

| Field | Detail |
|---|---|
| **Severity** | **P3 — Dead Code** |
| **Area** | Regime Detection |
| **Description** | `detectRegime()` in regime-detector.ts is exported but never imported or called by any production module. The multi-indicator scoring system (SPY vs 200MA, DI, VIX, A/D ratio, CHOP band) is unused. The actual regime gate for trading uses `getMarketRegime()` (simple SPY price/MA check). Dashboard uses `detectDualRegime()`. |
| **Evidence** | Exported at [regime-detector.ts L24](src/lib/regime-detector.ts#L24). No imports found via global search: only references are in `AUDIT_PHASE1_INVENTORY.md` (this audit) and the function definition itself. `getMarketRegime()` is used by scan and positions API. `detectDualRegime()` is used by modules API for dashboard display. |
| **Impact** | The sophisticated multi-indicator regime logic that includes VIX, A/D ratio, and DI scoring is never used for trade decisions. The actual trade gate is the simpler `getMarketRegime()` which only checks SPY price vs MA200 and MA50 vs MA200. This is a missed opportunity but not a bug. |
| **Minimal Fix** | Either: (a) remove `detectRegime()` and related `RegimeInput` type if intentionally replaced, or (b) wire it into the trade gate if the multi-indicator logic was intended to be used. This is a product decision. Add a `@deprecated` JSDoc comment if keeping as historical reference. |
| **Validate** | (a) Remove function → compile succeeds, all tests pass. (b) Wire up → add integration test confirming VIX/DI/A/D indicators affect regime output. |

---

## Summary Matrix

| ID | Sev | Area | One-Line Description | Runtime Impact |
|---|---|---|---|---|
| F-001 | **P0** | Stops | R-multiple formula in sync-stops shifted +1R vs stop-manager | Wrong protection labels on CSV-imported stops |
| F-002 | P2 | Stops | `\|\|` vs `??` on initialRisk in sync-stops | Edge case: initialRisk=0 mishandled |
| F-003 | **P1** | Regime | getMarketRegime defaults BULLISH on error/no data | Entries permitted during outage or bearish regime |
| F-004 | P2 | Risk API | positions API riskGBP allows negative values | Confusing display when stop > entry |
| F-005 | **P1** | Stops | updateStopLoss re-derives level from stop (not price) | Wrong protection level persisted in DB |
| F-006 | P3 | Risk Gates | Concentration gates denominator = portfolio value, not equity | Gates always fail with < 3 positions |
| F-007 | P3 | Types | LOCK_08R enum name implies +0.8R, formula is +0.5R | Developer confusion only |
| F-008 | P3 | Regime | detectRegime() is dead code | Multi-indicator logic unused |

**Priority Order for Fixes:** F-001 → F-003 → F-005 → F-004 → F-002 → F-006 → F-007 → F-008

---

**END OF PHASE 4 FINDINGS TABLE — STOP.**
