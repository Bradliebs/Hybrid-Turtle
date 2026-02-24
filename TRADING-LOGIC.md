# Hybrid-Turtle — Complete Trading Logic Reference

> Auto-generated reference of all trading rules, thresholds, and decision logic.

---

## Table of Contents

1. [Overall Trade Workflow](#1-overall-trade-workflow)
2. [Scan Engine — 7-Stage Pipeline](#2-scan-engine--7-stage-pipeline)
3. [Anti-Chase Guard](#3-anti-chase-guard)
4. [Risk Gates — 6 Gates](#4-risk-gates--6-gates)
5. [Position Sizing](#5-position-sizing)
6. [Stop Manager](#6-stop-manager)
7. [Dual Score Engine (BQS / FWS / NCS)](#7-dual-score-engine-bqs--fws--ncs)
8. [Regime Detector](#8-regime-detector)
9. [Exit Signals](#9-exit-signals)
10. [Modules](#10-modules)
11. [Weekly Phase Schedule](#11-weekly-phase-schedule)
12. [Pre-Trade Checklist](#12-pre-trade-checklist)
13. [Nightly Process](#13-nightly-process)
14. [Cross-Reference System](#14-cross-reference-system)
15. [Snapshot Sync](#15-snapshot-sync)
16. [Equity Snapshot](#16-equity-snapshot)
17. [Risk Profile Constants](#17-risk-profile-constants)
18. [API Routes — Quick Reference](#18-api-routes--quick-reference)

---

## 1. Overall Trade Workflow

```
Universe (DB)
  → Technical Filters (MA200, ADX, DI, ATR%, data quality, efficiency)
  → Status Classification (READY / WATCH / FAR)
  → Ranking (sleeve priority + status bonus + ADX + volume + efficiency + RS)
  → Adaptive ATR Buffer (entry trigger calculation)
  → Position Sizing (equity × risk% / R-per-share)
  → Risk Gates (6 gates: open risk, max positions, sleeve, cluster, sector, position cap)
  → Anti-Chase Guard (Monday only)
  → Cross-Reference with Dual Scores (BQS/FWS/NCS)
  → Pre-Trade Checklist (14 checks)
  → Execute on Tuesday (EXECUTION phase)
```

**Nightly loop:**
```
Health Check → Live Prices → Stop Management (R-based + trailing ATR)
  → Laggard/Dead Money Detection → Risk Modules (climax, swap, whipsaw, breadth, momentum)
  → Equity Snapshot + Pyramid Check → Snapshot Sync → Telegram Alert → Heartbeat
```

### End-to-End Decision Tree (Current Code)

```text
INPUTS:
  userId, riskProfile, equity, universe stock metadata, live price/technicals

SCAN PATH:
  1) Stage 1 Universe
    - Load active stocks from DB

  2) Stage 2 Technical Filters
    - Hard filters: price>MA200, ADX>=20, +DI>-DI, ATR% cap, data quality
    - Soft rule: efficiency<30 demotes READY->WATCH
    - ATR spike:
      bullish DI -> SOFT_CAP (READY->WATCH)
      bearish DI -> HARD_BLOCK (candidate FAR + fails filters)

  3) Entry Trigger / Stop Seed
    - entryTrigger = adaptive ATR buffer output
    - stop = entryTrigger - ATR * stopMultiplier

  4) Stage 3 Classify
    - distance<=2% READY; <=3% WATCH; else FAR

  5) Stage 4 Rank
    - sleeve priority + status bonus + ADX + volume + efficiency + RS

  6) Stage 7 Sizing (first pass)
    - riskCashRaw = equity * riskPerTrade
    - apply risk_cash_cap / risk_cash_floor
    - shares = floor(riskCash / riskPerShare)
    - enforce sleeve position-size cap
    - enforce per-position max-loss guard

  7) Stage 5 Risk Gates
    - open risk, max positions, sleeve cap, cluster cap, sector cap, position-size cap
    - profile-aware caps via getProfileCaps()

  8) Stage 6 Anti-Chase
    - ext_atr = (close - entryTrigger) / ATR
    - if ext_atr > 0.8:
      status = WAIT_PULLBACK (candidate kept, breakout blocked)
     else:
      run anti-chase guard (Monday-only gap checks)

  9) Mode B Pullback Continuation (only WAIT_PULLBACK)
    - anchor = max(HH20, EMA20)
    - zone = anchor ± 0.25*ATR
    - trigger if low entered zone AND close > zoneHigh
    - stop = pullbackLow - 0.5*ATR
    - if triggered:
      set mode = PULLBACK_CONTINUATION
      promote status to READY
      replace entry/stop with pullback values
      re-run sizing + risk gates with same caps

 10) Output + Sorting
    - Trigger-met first, then READY, WATCH/WAIT_PULLBACK, FAR
    - Persist scan rows with entryMode + stage6Reason

ENTRY EXECUTION PATH (POST /api/positions):
  A) Hard server-side pre-trade gates
    - block on Monday OBSERVATION phase
    - block if regime != BULLISH
    - block if latest health check is RED
    - block if stop >= entry

  B) If allowed, create position
    - persist entry snapshot:
     entry_price, initial_stop, initial_R, atr_at_entry, profile_used, entry_type
```

---

## 2. Scan Engine — 7-Stage Pipeline

**Source:** `src/lib/scan-engine.ts`

### Stage 1: Universe

Queries all `active: true` stocks from the database, extracting `ticker`, `name`, `sleeve`, `sector`, `cluster`, `currency`.

### Stage 2: Technical Filters

ALL hard filters must pass for a candidate to proceed:

| Filter | Rule | Notes |
|--------|------|-------|
| Price above MA200 | `price > technicals.ma200` | Hard filter |
| ADX ≥ 20 | `technicals.adx >= 20` | Hard filter |
| +DI > −DI | `technicals.plusDI > technicals.minusDI` | Hard filter |
| ATR% below threshold | `technicals.atrPercent < threshold` | 7% for HIGH_RISK, 8% for all others |
| Data quality | `technicals.ma200 > 0 && technicals.adx > 0` | Hard filter |
| Efficiency ≥ 30 | `technicals.efficiency >= 30` | **Soft filter** — demotes READY → WATCH |

**ATR Spike Logic:**

- `atrSpiking && bullishDI` → **SOFT_CAP**: demote READY → WATCH
- `atrSpiking && !bullishDI` → **HARD_BLOCK**: force status to FAR, fail filters

### Stage 3: Status Classification

Based on distance from current price to entry trigger:

```
distance = ((entryTrigger - price) / price) × 100

distance ≤ 2%  → READY
distance ≤ 3%  → WATCH
distance > 3%  → FAR
```

### Stage 4: Ranking

Composite score calculation:

| Component | Formula |
|-----------|---------|
| Sleeve priority | CORE=40, ETF=20, HIGH_RISK=10, HEDGE=5 |
| Status bonus | READY=+30, WATCH=+10, FAR=0 |
| ADX tiebreaker | `min(adx, 50) × 0.3` |
| Volume ratio | `min(volumeRatio, 3) × 5` |
| Efficiency | `min(efficiency, 100) × 0.2` |
| Relative strength | `min(relativeStrength, 100) × 0.1` |

Results sorted by rank score descending.

### Stage 5: Risk Gates

Delegates to `validateRiskGates()` — see [§4](#4-risk-gates--6-gates).

### Stage 6: Anti-Chase Guard

Delegates to `checkAntiChasingGuard()` — see [§3](#3-anti-chase-guard).

### Stage 7: Position Sizing

Uses `calculatePositionSize()` — see [§5](#5-position-sizing).

- **Entry trigger:** `adaptiveBuffer.adjustedEntryTrigger` (from Module 11b)
- **Stop price:** `entryTrigger − ATR × 1.5`
- **Processing:** Batches of 10, 300ms pause between batches

---

## 3. Anti-Chase Guard

**Source:** `src/lib/scan-guards.ts`

**Only active on Mondays** (`dayOfWeek === 1`). All other days automatically pass.

Only evaluates when `currentPrice >= entryTrigger`:

| Check | Rule | Threshold |
|-------|------|-----------|
| Gap ATR check | `(currentPrice − entryTrigger) / ATR` | > 0.75 → FAIL ("CHASE RISK") |
| Percent above check | `((currentPrice / entryTrigger) − 1) × 100` | > 3.0% → FAIL |

Both must pass to clear the guard.

---

## 4. Risk Gates — 6 Gates

**Source:** `src/lib/risk-gates.ts`

All 6 gates must pass before a new position is allowed:

| # | Gate | Rule | Default Thresholds |
|---|------|------|--------------------|
| 1 | **Total Open Risk** | `(currentOpenRisk + newRiskDollars) / equity × 100 ≤ maxOpenRisk` | CON=7%, BAL=5.5%, SMALL=10%, AGG=6% |
| 2 | **Max Positions** | `openPositions < maxPositions` (ex-HEDGE) | CON=8, BAL=5, SMALL=4, AGG=2 |
| 3 | **Sleeve Limit** | `sleeveValue / totalPortfolioValue ≤ SLEEVE_CAPS[sleeve]` | CORE=80%, ETF=80%, HIGH_RISK=40%, HEDGE=100% |
| 4 | **Cluster Concentration** | `clusterValue / totalPortfolioValue ≤ clusterCap` | Default 20% — **SMALL_ACCOUNT: 25%** |
| 5 | **Sector Concentration** | `sectorValue / totalPortfolioValue ≤ sectorCap` | Default 25% — **SMALL_ACCOUNT: 30%** |
| 6 | **Position Size Cap** | `newValue / totalPortfolioValue ≤ cap` | See profile-aware table below |

> **Profile-Aware Overrides:** Gates 4–6 support per-profile cap overrides via `getProfileCaps(riskProfile)` in `src/types/index.ts`. Profiles without overrides use the default constants.

**CRITICAL:** HEDGE positions are **excluded** from open risk counting and max position counting.

### Pyramiding Rules

`canPyramid(currentPrice, entryPrice, initialRisk, atr, currentAdds)`:

| Parameter | Value |
|-----------|-------|
| Max adds | 2 |
| Add #1 trigger | `Entry + 0.5 × ATR` |
| Add #2 trigger | `Entry + 1.0 × ATR` |
| Add sizing | Same as original (full equity × risk_per_trade) |
| Fallback (no ATR) | R-multiple ≥ 1.0 required |

### Risk Budget

`getRiskBudget()` calculates used vs available:

- Used risk percent (sum of open position risk)
- Used positions vs max positions
- Sleeve utilization by sleeve type
- HEDGE excluded from open risk total

---

## 5. Position Sizing

**Source:** `src/lib/position-sizer.ts`

### Core Formula

```
Shares = floor( (Equity × Risk%) / ((Entry − Stop) × fxToGbp) × 100 ) / 100
```

Floors to 2 decimal places (0.01 shares) when `allowFractional: true` (Trading 212). Whole shares when `allowFractional: false` (default).

### Position Size Cap Enforcement

If `shares × entryPrice × fxToGbp > equity × positionSizeCap[sleeve]`, clamp shares down.

Position size caps are **profile-aware** — see [Concentration Caps](#concentration-caps) for per-profile values.

### Risk Per Trade by Profile

| Profile | Risk Per Trade |
|---------|---------------|
| CONSERVATIVE | 0.75% |
| BALANCED | 0.95% |
| SMALL_ACCOUNT | 2.00% |
| AGGRESSIVE | 3.00% |

### Helper Functions

| Function | Formula |
|----------|---------|
| `calculateEntryTrigger(twentyDayHigh, atr)` | `twentyDayHigh + 0.1 × ATR` (legacy — now replaced by adaptive buffer) |
| `calculateRMultiple(currentPrice, entryPrice, initialRisk)` | `(currentPrice − entryPrice) / initialRisk` |
| `calculateGainPercent(currentPrice, entryPrice)` | `((currentPrice − entryPrice) / entryPrice) × 100` |
| `calculateGainDollars(currentPrice, entryPrice, shares)` | `(currentPrice − entryPrice) × shares` |

---

## 6. Stop Manager

**Source:** `src/lib/stop-manager.ts`

### Critical Safety Rule

**Stops NEVER go down.** Monotonic enforcement — any attempt to lower a stop is rejected.

### R-Based Protection Levels

| Level | R-Multiple Threshold | Stop Formula |
|-------|----------------------|--------------|
| `INITIAL` | < 1.5R | `Entry − InitialRisk` |
| `BREAKEVEN` | ≥ 1.5R | `Entry` (break even) |
| `LOCK_08R` | ≥ 2.5R | `Entry + 0.5 × InitialRisk` |
| `LOCK_1R_TRAIL` | ≥ 3.0R | `max(Entry + 1.0 × InitialRisk, Close − 2 × ATR)` |

### Stop Recommendation Logic

`calculateStopRecommendation`:

1. Calculate R-multiple from current price
2. Determine recommended protection level
3. Only upgrade levels (never downgrade)
4. Calculate new stop for that level
5. **Monotonic check:** if `newStop ≤ currentStop` → return null (no action)

### Trailing ATR Stop

`calculateTrailingATRStop(ticker, entryPrice, entryDate, currentStop, atrMultiplier=2.0)`:

- Walks forward through price history from entry date
- At each bar: `candidateStop = highestClose − 2 × ATR(14)`
- Stop only ratchets UP (monotonic)
- Returns recommendation only if `trailingStop > currentStop`

### Batch Operations

- `generateTrailingStopRecommendations(userId)` — generates recommendations for all open positions
- `updateStopLoss(positionId, newStop, reason)` — writes to DB with stop history, enforces monotonic rule

---

## 7. Dual Score Engine (BQS / FWS / NCS)

**Source:** `src/lib/dual-score.ts`

Three scores: **BQS** (Breakout Quality Score — good), **FWS** (Fatal Weakness Score — bad), **NCS** (Net Composite Score — final verdict).

### BQS Components (0–100 total)

| Component | Weight | Formula |
|-----------|--------|---------|
| Trend Strength | 0–25 | `25 × clamp((ADX − 15) / 20)` |
| Direction Dominance | 0–10 | `10 × clamp((+DI − −DI) / 25)` |
| Volatility Health | 0–15 | ATR% < 1% → scale up; 1–4% → 15 (full); 4–6% → scale down; > 6% → 0 |
| Proximity | 0–15 | `15 × clamp(1 − dist20dHigh / 3.0)` |
| Market Tailwind | 0–15 | BULLISH+stable=15, BULLISH+unstable=9, NEUTRAL=6, BEARISH=1.5 |
| RS Score | 0–15 | `15 × clamp((rsPct + 5) / 20)` |
| Volume Bonus | 0–5 | If volRatio > 1.2: `5 × clamp((volRatio − 1.2) / 0.6)` |

### FWS Components (0–100 total, higher = worse)

| Component | Weight | Formula |
|-----------|--------|---------|
| Volume Risk | 0–30 | `30 × clamp(1 − (volRatio − 0.6) / 0.6)` |
| Extension Risk | 0–25 | Both chasing flags = 25; either = 15; none = 0 |
| Marginal Trend Risk | 0–10 | ADX < 20 → 10; 20–25 → 7; 25–30 → 3; > 30 → 0 |
| Vol Shock Risk | 0–20 | `atr_spiking` → 20; `atr_collapsing` → 10; else 0 |
| Regime Instability | 0–10 | Not stable → 10; stable → 0 |

### Penalties (applied to NCS)

| Penalty | Formula |
|---------|---------|
| **Earnings** | ≤ 1 day → −20; ≤ 3 days → −15; ≤ 5 days → −10; flag set → −12 |
| **Cluster** | At 80–100% of cap: linear 0–20; above cap: 20 + 30×(overshoot) |
| **Super Cluster** | At 80–100% of cap: linear 0–25; above cap: 25 + 40×(overshoot) |

### NCS (Net Composite Score)

```
BaseNCS = clamp(BQS − 0.8 × FWS + 10)
NCS     = clamp(BaseNCS − EarningsPenalty − ClusterPenalty − SuperClusterPenalty)
```

### Action Classification

| Condition | Action |
|-----------|--------|
| `FWS > 65` | **Auto-No** (fragile) |
| `NCS ≥ 70 && FWS ≤ 30` | **Auto-Yes** |
| Otherwise | **Conditional** — needs confirmation (e.g., volume ≥ 1.0 on breakout day) |

---

## 8. Regime Detector

**Source:** `src/lib/regime-detector.ts`

### Primary Regime Detection

Point-based system:

| Signal | Bullish Points | Bearish Points |
|--------|---------------|----------------|
| SPY > 200MA | +3 | — |
| SPY < 200MA | — | +3 |
| +DI > −DI | +2 | — |
| −DI > +DI | — | +2 |
| VIX < 20 | +1 | — |
| VIX > 30 | — | +1 |
| A/D ratio > 1.2 | +1 | — |
| A/D ratio < 0.8 | — | +1 |

### ±2% CHOP Band (Module 10)

```
upperBand = spy200MA × 1.02
lowerBand = spy200MA × 0.98

If SPY price inside band → forced SIDEWAYS (confidence 0.5)
```

### Without CHOP Band

| Total Points | Regime |
|-------------|--------|
| Bullish ≥ 5 | BULLISH |
| Bearish ≥ 5 | BEARISH |
| Otherwise | SIDEWAYS |

### Regime Stability (Module 9)

`checkRegimeStability(currentRegime, regimeHistory)`:

- Requires **3 consecutive days** of same regime before confirming
- If unstable → display as "CHOP" / SIDEWAYS

### Dual Benchmark (Module 19)

`detectDualRegime(spyPrice, spyMa200, vwrlPrice, vwrlMa200)`:

- Both SPY and VWRL use ±2% CHOP band detection
- **Combined rules:**
  - Both BULLISH → BULLISH
  - Either BEARISH → BEARISH
  - Otherwise → SIDEWAYS

### Buy Permission

`canBuy(regime)` → returns `true` **only** for BULLISH regime.

---

## 9. Exit Signals

### Laggard Detector

**Source:** `src/lib/laggard-detector.ts`

#### TRIM_LAGGARD Flag (all must be true)

1. `daysHeld ≥ 10`
2. `currentPrice < entryPrice` (underwater)
3. `lossPct ≥ 2%`
4. `currentPrice > currentStop` (not already at stop)
5. Not a HEDGE position

#### DEAD_MONEY Flag (all must be true)

1. `daysHeld ≥ 30`
2. `rMultiple < 0.5`
3. `rMultiple > −1.0` (not in freefall)
4. Not a HEDGE position

These are **suggestions only** — not auto-sell.

### Climax Detector (Module 5 + 14)

**Source:** `src/lib/modules/climax-detector.ts`

**Blow-off top detection** — both conditions must be true:

- Price > **18%** above MA20
- Volume > **3×** average 20-day volume

**Action:** TRIM (50%) or TIGHTEN stop (configurable).

### Laggard Purge (Module 3)

**Source:** `src/lib/modules/laggard-purge.ts`

Flags positions held > 10 days that are underwater > 2%. HEDGE exempt. Sorted worst-first.

---

## 10. Modules

### Module 2: Early Bird Entry

**Source:** `src/lib/modules/early-bird.ts`

Aggressive entry before ADX confirms. **All 3 criteria must be met:**

1. Price in top 10% of 55-day range (`rangePctile ≥ 90`)
2. Volume > 1.5× 20-day average
3. Regime is BULLISH

### Module 7: Heatmap Swap

**Source:** `src/lib/modules/heatmap-swap.ts`

Suggests swaps when cluster is ≥ 80% of cap:

- **Weak position:** `rMultiple < 0.5` AND underwater (negative R)
- **Strong candidate:** `rankScore ≥ 50` and status READY
- Only suggests when there's a meaningful upgrade

### Module 8: Heat Check

**Source:** `src/lib/modules/heat-check.ts`

If **3+** positions in same cluster, the 4th candidate must have momentum **20% better** than the cluster average R-multiple. Prevents over-concentration in mediocre names.

### Module 9: Fast-Follower Re-Entry

**Source:** `src/lib/modules/fast-follower.ts`

For STOP_HIT exits within last **10 days**. Re-entry allowed if:

1. Price reclaimed 20-day high
2. Volume > 2× average

### Module 10: Breadth Safety Valve

**Source:** `src/lib/modules/breadth-safety.ts`

- `calculateBreadth(tickers)` — % of universe above 50DMA
- **Threshold:** < 40% → restricted
- **Action:** Max positions reduced to **4** (from profile max)

### Module 11: Whipsaw Kill Switch

**Source:** `src/lib/modules/whipsaw-guard.ts`

Blocks re-entry on tickers stopped out **2 times within 30 days**. Penalty period: **60 days**.

### Module 11b: Adaptive ATR Buffer

**Source:** `src/lib/modules/adaptive-atr-buffer.ts`

Scales entry buffer inversely with ATR%:

| ATR% | Buffer (% of ATR) |
|------|-------------------|
| ≤ 2% | 20% |
| ≥ 6% | 5% |
| Between | Linear interpolation |

```
adjustedEntryTrigger = twentyDayHigh + bufferPercent × ATR
```

Feature flag for A/B comparison:

- `USE_PRIOR_20D_HIGH_FOR_TRIGGER=true` → `adjustedEntryTrigger = prior20DayHigh + bufferPercent × ATR` (excludes most recent bar)
- unset/`false` (default) → `adjustedEntryTrigger = twentyDayHigh + bufferPercent × ATR` (includes most recent bar)

### Module 12: Super-Cluster

**Source:** `src/lib/modules/super-cluster.ts`

Groups correlated clusters into super-clusters with a **50% aggregate cap** (`SUPER_CLUSTER_CAP = 0.50`).

### Module 13: Momentum Expansion

**Source:** `src/lib/modules/momentum-expansion.ts`

When SPY ADX > **25** (strong trend):

- Max open risk expanded by factor **1.214** (e.g., 7.0% → 8.5%)

### Module 15: Trade Logger

**Source:** `src/lib/modules/trade-logger.ts`

Logs BUY/SELL/TRIM with expected vs actual fill, slippage %. Provides execution quality audit trail.

### Module 16: Turnover Monitor

**Source:** `src/lib/modules/turnover-monitor.ts`

Tracks:

- Trades per 30 days
- Average holding period (days)
- Oldest position age
- Closed positions in last 30 days

### Module 17: Weekly Action Card

**Source:** `src/lib/modules/weekly-action-card.ts`

Auto-generated one-page battle plan combining: regime, breadth, ready candidates, trigger-met, stop updates, risk budget, laggards, climax, whipsaw, swaps, fast-followers, re-entry. Also renders to markdown.

### Module 18: Data Validator

**Source:** `src/lib/modules/data-validator.ts`

| Check | Threshold |
|-------|-----------|
| Data age | ≤ 5 business days |
| Daily price spike | ≤ 25% (anomaly detection) |
| Price validity | Non-zero, positive |
| Volume validity | Non-zero (halt check) |
| Stale data | No 3+ day identical close |

### Module 20: Re-Entry Logic

**Source:** `src/lib/modules/re-entry-logic.ts`

For profitable exits (> 0.5R, NOT stop-hit):

- **5-day cooldown** required
- Must reclaim 20-day high
- Only considers exits within last 30 days

---

## 11. Weekly Phase Schedule

| Day | Phase | Trading Allowed? | Actions |
|-----|-------|-----------------|---------|
| Sunday | PLANNING | No | Review health, run scans |
| Monday | OBSERVATION | **DO NOT TRADE** | Observe market, anti-chase guard active |
| Tuesday | EXECUTION | **Yes** | Execute planned trades |
| Wednesday | MAINTENANCE | Monitor only | Update stops, review positions |
| Thursday | MAINTENANCE | Monitor only | Update stops, review positions |
| Friday | MAINTENANCE | Monitor only | Update stops, review positions |
| Saturday | — | No | — |

---

## 12. Pre-Trade Checklist

**Source:** `src/components/plan/PreTradeChecklist.tsx`

14 checks across 4 categories. Items marked **(CRITICAL)** are blocking.

### Market Conditions

1. Market regime is BULLISH **(CRITICAL)**
2. Fear & Greed not in Extreme Fear
3. S&P above 200-day MA

### System Health

4. Health check is GREEN **(CRITICAL)**
5. All 16 health items pass
6. Data is fresh (< 24h)

### Risk Gate

7. Total open risk < limit
8. Position count < max
9. Sleeve caps not breached

### Entry Rules (gated by hasReadyCandidates)

10. Candidate passed all 6 technical filters (100%) **(CRITICAL)**
11. Entry trigger uses 20-day high + ATR buffer
12. Stop-loss is pre-set before entry **(CRITICAL)**
13. Position size uses formula: `Shares = (Equity × Risk%) / (Entry − Stop)`
14. Shares rounded DOWN (never up)

---

## 13. Nightly Process — 9 Steps

**Source:** `src/cron/nightly.ts`

| Step | Action | Details |
|------|--------|---------|
| 1 | Health Check | Run 16-point health check |
| 2 | Live Prices | Fetch live prices for all open positions (batch via Yahoo) |
| 3 | Stop Management | Generate R-based stop recommendations + **auto-apply trailing ATR stops** (2×ATR below highest close) |
| 4 | Laggard Detection | Detect TRIM_LAGGARD + DEAD_MONEY flags |
| 5 | Risk Modules | Run: Climax, Swap, Whipsaw, Breadth Safety (sampled 30 tickers), Momentum Expansion |
| 6 | Equity Snapshot | Record equity snapshot (min 6h between snapshots) + check pyramid add opportunities |
| 7 | Snapshot Sync | Sync snapshot data from Yahoo (full universe) + query READY/trigger-met candidates (top 15) |
| 8 | Telegram Alert | Send summary: alerts, positions, stop changes, candidates, module results |
| 9 | Heartbeat | Write heartbeat to DB (SUCCESS or FAILED) |

Runs via: `npx tsx src/cron/nightly.ts --run-now`

---

## 14. Cross-Reference System

**Source:** `src/app/api/scan/cross-ref/route.ts`

Merges 7-stage scan results with dual scores:

### Classification

| Condition | Match Type |
|-----------|-----------|
| Scan recommends AND Dual recommends | **BOTH_RECOMMEND** |
| Only scan recommends | SCAN_ONLY |
| Only dual recommends | DUAL_ONLY |
| Scan recommends AND Dual rejects | CONFLICT |
| Neither recommends | BOTH_REJECT |

Where:

- `scanRecommends` = passesAllFilters AND (READY or WATCH)
- `dualRecommends` = NCS ≥ 50 AND FWS ≤ 50

### Agreement Score

Weighted combination:

- 25% — scan recommend (boolean)
- 25% — dual recommend (boolean)
- 25% — NCS normalized (0–1)
- 25% — rank score normalized (0–1)

### Display Priority

Trigger-met first → BOTH_RECOMMEND → others, then by agreement score descending.

---

## 15. Snapshot Sync

**Source:** `src/lib/snapshot-sync.ts`

Replaces the Python `master_snapshot` pipeline.

### Processing Parameters

| Parameter | Value |
|-----------|-------|
| Batch size | 8 concurrent Yahoo requests |
| Batch delay | 400ms between batches |
| Minimum data | 55 bars required per ticker |
| ATR spike detection | Current ATR ≥ 1.3× ATR from 20 days ago |
| ATR collapse detection | Current ATR ≤ 0.5× ATR from 20 days ago |
| Chasing detection | 20d/55d high touched in last 5 bars (within 0.1%) |
| Liquidity check | 20-day avg dollar volume > $500,000 |
| Relative strength | 63-day (~3 month) return vs SPY return |
| Regime stability | `|SPY price − MA200| / MA200 > 2%` |

### Status Classification in Snapshot

| Condition | Status |
|-----------|--------|
| Not above MA200 or −DI dominant | IGNORE |
| Distance to 20d high ≤ 2% | READY |
| Distance to 20d high ≤ 5% | WATCH |
| Distance to 20d high > 5% | FAR |
| Override: above MA200 + ADX ≥ 20 + bullish DI + dist > 5% | TREND |

### Calculated Values

- **Entry trigger:** `20-day high + ATR × 0.1`
- **Stop level:** `entryTrigger − ATR × 1.5`
- **Default cluster cap:** max cluster = 35%, max super-cluster = 60%

---

## 16. Equity Snapshot

**Source:** `src/lib/equity-snapshot.ts`

| Function | Description |
|----------|-------------|
| `recordEquitySnapshot(userId, equity, openRiskPercent?)` | Writes to DB, rate-limited to **once per 6 hours** (360 minutes) |
| `getWeeklyEquityChangePercent(userId)` | Calculates weekly equity change % and max open risk used this week |

---

## 17. Risk Profile Constants

### Risk Per Trade & Limits

| Profile | Risk/Trade | Max Positions | Max Open Risk |
|---------|-----------|---------------|---------------|
| CONSERVATIVE | 0.75% | 8 | 7.0% |
| BALANCED | 0.95% | 5 | 5.5% |
| SMALL_ACCOUNT | 2.00% | 4 | 10.0% |
| AGGRESSIVE | 3.00% | 3 | 12.0% |

### Sleeve Caps

| Sleeve | Allocation Cap | Position Size Cap (default) |
|--------|---------------|----------------------------|
| CORE | 80% | 16% (SMALL_ACCOUNT: 20%, BALANCED: 18%) |
| ETF | 80% | 16% |
| HIGH_RISK | 40% | 12% |
| HEDGE | 100% | 20% |

### Concentration Caps

Default values (used for CONSERVATIVE and AGGRESSIVE profiles):

| Cap | Default Value |
|-----|---------------|
| Cluster | 20% |
| Sector | 25% |
| Super-Cluster | 50% |
| ATR Volatility (all) | 8% |
| ATR Volatility (HIGH_RISK) | 7% |

#### Profile-Aware Overrides

Certain profiles receive looser caps via `getProfileCaps()`. Add new overrides in `PROFILE_CAP_OVERRIDES` in `src/types/index.ts`.

| Override | CONSERVATIVE | BALANCED | SMALL_ACCOUNT | AGGRESSIVE |
|----------|-------------|----------|---------------|------------|
| Cluster Cap | 20% (default) | 20% (default) | **25%** | **35%** |
| Sector Cap | 25% (default) | 25% (default) | **30%** | **45%** |
| Position Size Cap (CORE) | 16% (default) | **18%** | **20%** | **40%** |
| Position Size Cap (ETF) | 16% (default) | 16% (default) | 16% (default) | **40%** |
| Position Size Cap (HIGH_RISK) | 12% (default) | 12% (default) | 12% (default) | **20%** |
| Position Size Cap (HEDGE) | 20% (default) | 20% (default) | 20% (default) | 20% (default) |

### Protection Levels

| Level | R-Multiple Trigger | Stop Formula |
|-------|-------------------|--------------|
| INITIAL | 0R | Entry − InitialRisk |
| BREAKEVEN | 1.5R | Entry |
| LOCK_08R | 2.5R | Entry + 0.5 × InitialRisk |
| LOCK_1R_TRAIL | 3.0R | max(Entry + 1.0 × InitialRisk, Close − 2×ATR) |

---

## 18. API Routes — Quick Reference

### Market Data

| Route | Purpose |
|-------|---------|
| `GET /api/market-data?action=quote&ticker=AAPL` | Single stock quote |
| `GET /api/market-data?action=quotes&tickers=AAPL,MSFT` | Batch quotes |
| `GET /api/market-data?action=prices&tickers=AAPL,MSFT` | Batch prices only |
| `GET /api/market-data?action=indices` | Market indices |
| `GET /api/market-data?action=fear-greed` | Fear & Greed Index |
| `GET /api/market-data?action=regime` | Market regime (SPY vs 200-MA) |
| `GET /api/market-data?action=historical&ticker=AAPL` | Daily OHLCV bars |

### Scan & Scoring

| Route | Purpose |
|-------|---------|
| `POST /api/scan` | Run full 7-stage scan |
| `GET /api/scan` | Get cached scan results |
| `GET /api/scan/scores` | Dual scores for all tickers |
| `GET /api/scan/cross-ref` | Cross-referenced scan + dual scores |

### Positions & Stops

| Route | Purpose |
|-------|---------|
| `GET /api/positions` | All positions with live enrichment |
| `POST /api/positions` | Create new position |
| `PATCH /api/positions` | Close/exit position |
| `PUT /api/stops` | Update stop (monotonic) |
| `GET /api/stops` | Generate stop recommendations |
| `GET /api/stops/sync` | Trailing ATR recommendations |
| `POST /api/stops/sync` | Import stops from CSV |
| `PUT /api/stops/sync` | Auto-apply trailing ATR stops |

### Planning & Modules

| Route | Purpose |
|-------|---------|
| `GET /api/plan` | Weekly execution plan |
| `GET /api/modules` | Run all 21 modules |
| `POST /api/nightly` | Full 9-step nightly process |

### Trading 212 Integration

| Route | Purpose |
|-------|--------|
| `GET /api/stops/t212` | List all pending T212 stop orders (both Invest & ISA) |
| `POST /api/stops/t212` | Set/replace a stop-loss on T212 for one position |
| `PUT /api/stops/t212` | Bulk push all DB stops to T212 (batch) |
| `DELETE /api/stops/t212` | Remove stop-loss orders from T212 |
| `POST /api/trading212/connect` | Connect T212 API credentials |
| `POST /api/trading212/sync` | Sync portfolio from T212 |

### Stocks & Trade Log

| Route | Purpose |
|-------|--------|
| `GET /api/stocks` | Stock/ticker management |
| `GET /api/trade-log` | Trade journal entries |
| `GET /api/trade-log/summary` | Trade log summary statistics |
| `GET /api/portfolio/summary` | Portfolio overview |
| `POST /api/positions/hedge` | Hedge position management |

### Scan Extensions

| Route | Purpose |
|-------|--------|
| `GET /api/scan/snapshots` | Scan snapshot data |
| `POST /api/scan/snapshots/sync` | Snapshot sync (universe refresh) |
| `GET /api/scan/live-prices` | Live price updates for scan results |
| `POST /api/modules/early-bird` | Early Bird entry scan (Module 2) |

### Risk & Settings

| Route | Purpose |
|-------|--------|
| `GET /api/risk` | Risk summary |
| `GET /api/settings` | User settings |
| `PUT /api/settings` | Update user settings |
| `GET /api/health-check` | 16-point health check |
| `GET /api/heartbeat` | Heartbeat status |
| `POST /api/settings/telegram-test` | Send test Telegram message |
| `GET /api/publications` | Publication/newsletter data |
