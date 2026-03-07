# HybridTurtle — Prediction Engine Upgrade
## Sequential Implementation Roadmap (7 Phases)

> **Stack:** Next.js 14 · TypeScript · Prisma/SQLite · Trading 212 API · Yahoo Finance  
> **Sacred files (never modify):** `stop-manager.ts` · `position-sizer.ts` · `risk-gates.ts` · `regime-detector.ts` · `dual-score.ts` · `scan-engine.ts`  
> **Pace:** One Claude Code prompt per session, sequentially ordered

---

## Phase 1 — Conformal Prediction Intervals on NCS

### Overview

NCS currently produces a point score (e.g. 67.3) with no attached uncertainty. This phase wraps NCS output in statistically calibrated prediction intervals, so every score becomes a range with a coverage guarantee. Because real trade outcome data is scarce, calibration uses a **synthetic bootstrap strategy**: run the scan engine over Yahoo Finance historical dates, collect NCS scores, compare against N-day forward returns, and derive residuals. The infrastructure is built to seamlessly swap in real trade outcome data as it accumulates.

### New Files to Create
- `lib/prediction/conformal-calibrator.ts` — core calibration logic
- `lib/prediction/conformal-store.ts` — persist/load calibration params via Prisma
- `lib/prediction/bootstrap-calibration.ts` — synthetic residual generator from YF historical data
- `app/api/prediction/calibrate/route.ts` — API endpoint to trigger recalibration
- `app/api/prediction/interval/route.ts` — API endpoint: given NCS score → return interval
- `components/NCSIntervalBadge.tsx` — UI component showing score + interval + confidence band
- `prisma/migrations/conformal_params` — new table: `ConformalCalibration`

### Files to Read First (instruct Claude Code to read before writing)
- `lib/dual-score.ts` (read only — understand NCS output shape)
- `lib/scan-engine.ts` (read only — understand how scores are produced)
- `prisma/schema.prisma` (read/extend — add ConformalCalibration model)
- `lib/yahoo-finance.ts` or equivalent (read only — understand data fetch patterns)
- `CLAUDE.md`

### Schema Addition
```prisma
model ConformalCalibration {
  id              Int      @id @default(autoincrement())
  calibratedAt    DateTime @default(now())
  coverageLevel   Float    // e.g. 0.90
  qHat            Float    // symmetric quantile
  qHatUp          Float    // asymmetric upside quantile
  qHatDown        Float    // asymmetric downside quantile
  sampleSize      Int
  regime          String?  // null = all regimes, or "TRENDING"/"RANGING"
  source          String   // "bootstrap" | "live_trades"
}
```

### Core Logic (provide to Claude Code as reference)
```typescript
// conformal-calibrator.ts — key functions

// 1. Given array of residuals (predicted NCS minus outcome-implied NCS),
//    compute quantile thresholds at given coverage level
function computeQHat(residuals: number[], coverage: number): number {
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = Math.ceil((n + 1) * coverage) - 1;
  return sorted[Math.min(idx, n - 1)];
}

// 2. At inference time, wrap any NCS score
function getInterval(ncs: number, qHatUp: number, qHatDown: number) {
  return {
    point: ncs,
    lower: ncs - qHatDown,
    upper: ncs + qHatUp,
    width: qHatUp + qHatDown,
  };
}

// 3. Revised decision logic using interval
function getConformalDecision(interval: Interval, thresholds: Thresholds) {
  if (interval.lower >= thresholds.autoYes) return 'AUTO_YES';       // pessimistic estimate clears bar
  if (interval.upper < thresholds.autoNo)  return 'AUTO_NO';         // even optimistic fails
  if (interval.point >= thresholds.autoYes) return 'CONDITIONAL';    // point clears but lower does not
  return 'CONDITIONAL';
}
```

### Bootstrap Calibration Strategy (no real trades needed)
```typescript
// bootstrap-calibration.ts
// For each ticker in universe (sample 50–80 for speed):
//   1. Fetch 6 months of daily OHLCV from Yahoo Finance
//   2. At each historical weekly "Tuesday" date, compute NCS using existing signal stack
//   3. Compute actual 10-day forward return from that date
//   4. Map forward return to an "outcome-implied NCS" using a percentile rank across all tickers
//   5. Residual = NCS_predicted - NCS_outcome_implied
// Collect 200–500 residuals. Compute qHat at 80%, 90%, 95% coverage.
// Store all three levels. Default display: 90%.
```

### Decision Logic Change (TodayPanel / signal display)
- Replace bare NCS number with `<NCSIntervalBadge>` component
- Show: `67.3 [61.1 – 73.5]` with a colour-coded confidence band
- Narrow band (width < 8) → green badge (high conviction)
- Medium band (8–15) → amber badge
- Wide band (> 15) → red badge (uncertain — treat as Conditional regardless of point score)
- Auto-Yes gate: only fires if `interval.lower >= AUTO_YES_THRESHOLD`

### Sacred File Prohibition
> ⛔ DO NOT modify: `stop-manager.ts`, `position-sizer.ts`, `risk-gates.ts`, `regime-detector.ts`, `dual-score.ts`, `scan-engine.ts`  
> NCS is READ from dual-score output. Conformal wrapping is a POST-PROCESSING layer only.

### Recalibration Schedule
- Trigger: nightly pipeline step (after scan completes)
- Condition: only recalibrate if `sampleSize` has grown by ≥ 20 since last calibration, OR if last calibration is > 30 days old
- As real trade outcomes accumulate in DB, `source` transitions from `"bootstrap"` to `"live_trades"` automatically

---

## Phase 2 — Failure Mode Scoring (beyond FWS)

### Overview

FWS currently captures fatal weaknesses as a composite. This phase decomposes failure risk into **five named failure modes**, each scored independently. A trade is rejected if *any single failure mode* exceeds its threshold — regardless of NCS. This mirrors aircraft safety logic: not "is the plane good overall?" but "does any specific failure mode exceed acceptable risk?"

### Five Failure Modes

| ID | Name | What It Detects |
|----|------|-----------------|
| FM1 | Breakout Failure Risk | Probability of false break / immediate reversal |
| FM2 | Liquidity Trap Risk | Volume drying up post-entry; inability to exit cleanly |
| FM3 | Correlation Cascade Risk | Portfolio correlation concentration; forced exit contagion |
| FM4 | Regime Flip Risk | Trend environment collapses mid-trade |
| FM5 | Event Gap Risk | Known earnings / macro event within stop distance |

### New Files to Create
- `lib/prediction/failure-mode-scorer.ts` — computes all 5 FM scores
- `lib/prediction/failure-mode-thresholds.ts` — configurable rejection thresholds per FM
- `app/api/prediction/failure-modes/route.ts` — returns FM scores for a given ticker
- `components/FailureModePanel.tsx` — UI: 5-row table with score + status per mode
- `prisma/migrations/failure_modes` — new table: `FailureModeScore`

### Files to Read First
- `lib/dual-score.ts` (read only — understand existing FWS construction)
- `lib/regime-detector.ts` (read only — use regime output as FM4 input)
- `lib/risk-gates.ts` (read only — understand existing gates to avoid duplication)
- `lib/position-sizer.ts` (read only — understand correlation logic for FM3)
- `prisma/schema.prisma` (read/extend)
- `CLAUDE.md`

### FM Score Algorithms (reference for Claude Code)

**FM1 — Breakout Failure Risk**
```typescript
// Inputs: recent false breakout rate for this ticker (last 6 months),
//         distance from 52w high (closer = higher risk),
//         volume on breakout day vs 20d avg volume (< 1.2x = higher risk),
//         ADX value (lower ADX = higher failure risk)
// Score 0–100: higher = more dangerous
fm1 = weightedSum([
  falseBreakoutRate * 40,
  (1 - volumeRatio.clamp(1,2)/2) * 25,
  (1 - adx/50).clamp(0,1) * 20,
  distanceFrom52wHigh < 0.02 ? 15 : 0
]);
```

**FM2 — Liquidity Trap Risk**
```typescript
// Inputs: average daily volume (ADV), bid-ask spread estimate,
//         ATR as % of price, market cap tier
fm2 = weightedSum([
  adv < 500_000 ? 40 : adv < 1_000_000 ? 20 : 0,
  spreadEstimate > 0.003 ? 30 : 0,
  marketCapTier === 'micro' ? 30 : marketCapTier === 'small' ? 15 : 0
]);
```

**FM3 — Correlation Cascade Risk**
```typescript
// Inputs: current open positions' sectors/regions,
//         correlation of candidate with existing positions
// Already partially computed in position-sizer — READ that logic, don't duplicate
// FM3 = max pairwise correlation with any open position * 100
fm3 = Math.max(...openPositions.map(p => correlationWith(candidate, p))) * 100;
```

**FM4 — Regime Flip Risk**
```typescript
// Inputs: DRS trend strength (from regime-detector — READ ONLY),
//         recent DRS volatility (std dev of last 10 DRS readings),
//         ADX slope (negative slope = weakening trend)
fm4 = weightedSum([
  drsVolatility * 40,
  adxSlope < 0 ? Math.abs(adxSlope) * 30 : 0,
  drsScore < 40 ? (40 - drsScore) * 0.75 : 0
]);
```

**FM5 — Event Gap Risk**
```typescript
// Inputs: days until next earnings (from EarningsCache),
//         distance from entry to stop as % of ATR,
//         known macro events in next 14 days (FOMC, CPI, NFP)
fm5 = weightedSum([
  daysToEarnings < 14 ? (14 - daysToEarnings) * 5 : 0,
  daysToEarnings < 7 ? 30 : 0,  // hard bump for imminent earnings
  knownMacroEventWithin7Days ? 20 : 0
]);
```

### Rejection Logic
```typescript
const FM_THRESHOLDS = {
  fm1: 65,  // breakout failure
  fm2: 70,  // liquidity trap
  fm3: 75,  // correlation cascade
  fm4: 60,  // regime flip
  fm5: 55,  // event gap (tightest — surprise events are catastrophic)
};

function failureModeGate(scores: FMScores): { pass: boolean; blockedBy: string[] } {
  const blocked = Object.entries(scores)
    .filter(([key, score]) => score > FM_THRESHOLDS[key])
    .map(([key]) => key);
  return { pass: blocked.length === 0, blockedBy: blocked };
}
```

### UI Integration
- Insert `<FailureModePanel>` below NCS interval badge in TodayPanel
- Each FM shows as a row: icon · name · score bar · PASS/WARN/BLOCK badge
- Any BLOCK → entire trade card gets a red border, Auto-Yes suppressed regardless of NCS

### Sacred File Prohibition
> ⛔ DO NOT modify sacred files. FM3 reads correlation data from position-sizer output — it calls the sizer's exported helpers but does not modify the file.

---

## Phase 3 — Dynamic Signal Weighting Meta-Model

### Overview

Your 7 signal layers (ADX, DI, Hurst, BIS, DRS, Weekly ADX, BPS) currently use static weights in NCS construction. This phase adds a **meta-model layer** that outputs dynamic weights based on current market regime, volatility environment, and sector context. The weights are applied on top of existing signal outputs — no changes to how signals are computed.

### New Files to Create
- `lib/prediction/signal-weight-meta-model.ts` — computes dynamic weight vector
- `lib/prediction/meta-model-trainer.ts` — offline training logic (runs weekly)
- `app/api/prediction/signal-weights/route.ts` — returns current weight vector
- `components/SignalWeightPanel.tsx` — visualises current weight vector as bar chart
- `prisma/migrations/signal_weights` — new table: `SignalWeightRecord`

### Files to Read First
- `lib/dual-score.ts` (read only — understand signal weight structure)
- `lib/regime-detector.ts` (read only — regime output is primary meta-model input)
- `lib/scan-engine.ts` (read only — understand signal computation order)
- `CLAUDE.md`

### Meta-Model Design

**Inputs (context vector):**
```typescript
interface MetaModelContext {
  regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION';
  vixPercentile: number;      // 0–100: where current VIX sits in 1yr distribution
  drsScore: number;           // from regime-detector
  recentAdxSlope: number;     // positive = strengthening trend
  sectorMomentum: number;     // sector ETF momentum score
  daysSinceLastDislocation: number; // days since VIX spike > 30
}
```

**Output (weight vector, sum = 1.0):**
```typescript
interface SignalWeights {
  adx: number;
  di: number;
  hurst: number;
  bis: number;
  drs: number;
  weeklyAdx: number;
  bps: number;
}
```

**Rule-based bootstrap (before enough data for learning):**
```typescript
// Trending regime → momentum signals dominate
if (regime === 'TRENDING' && vixPercentile < 60) {
  return { adx: 0.20, di: 0.15, hurst: 0.10, bis: 0.15, drs: 0.20, weeklyAdx: 0.12, bps: 0.08 };
}
// Ranging regime → mean-reversion signals (Hurst) dominate
if (regime === 'RANGING') {
  return { adx: 0.08, di: 0.08, hurst: 0.30, bis: 0.18, drs: 0.12, weeklyAdx: 0.08, bps: 0.16 };
}
// High volatility → BPS and BIS dominate (quality of breakout matters most)
if (vixPercentile > 80) {
  return { adx: 0.10, di: 0.08, hurst: 0.10, bis: 0.22, drs: 0.12, weeklyAdx: 0.10, bps: 0.28 };
}
// Default balanced
return { adx: 0.16, di: 0.13, hurst: 0.14, bis: 0.16, drs: 0.17, weeklyAdx: 0.12, bps: 0.12 };
```

**Learning upgrade (when 100+ calibrated outcomes available):**  
Replace rule-based lookup with a small gradient boosted regressor (use `ml-cart` or pure TS decision tree) trained on: context vector → which weights produced best NCS predictive accuracy for that context. Retrain weekly. Fall back to rule-based if training data insufficient.

### NCS Integration (non-invasive)
```typescript
// In the API layer that assembles NCS for display:
// 1. Fetch signal scores from scan-engine (unchanged)
// 2. Fetch current weight vector from meta-model
// 3. Reweight: adjustedNCS = Σ(weight_i × signal_i)
// dual-score.ts is NEVER modified — the reweighting is a display-layer adjustment
// Store both raw NCS and weighted NCS for comparison/audit
```

### Sacred File Prohibition
> ⛔ DO NOT modify sacred files. The meta-model reweights signal outputs at the API/display layer only. `dual-score.ts` and `scan-engine.ts` remain untouched.

---

## Phase 4 — Adversarial Stress Test Gate

### Overview

Before any Auto-Yes trade, run a Monte Carlo simulation that is **adversarially biased toward failure**. Generate N synthetic price paths consistent with current conditions, oversampling the tail. If > 25% of paths hit the stop within 7 days, the trade fails this gate regardless of NCS.

### New Files to Create
- `lib/prediction/adversarial-simulator.ts` — path generator + stop-hit analyser
- `app/api/prediction/stress-test/route.ts` — runs simulation for a given ticker
- `components/StressTestGauge.tsx` — dial showing stop-hit probability
- `prisma/migrations/stress_test` — new table: `StressTestResult`

### Files to Read First
- `lib/stop-manager.ts` (read only — understand stop distance calculation)
- `lib/position-sizer.ts` (read only — understand ATR usage)
- `lib/regime-detector.ts` (read only — regime feeds path generator)
- `CLAUDE.md`

### Simulation Design
```typescript
interface StressTestConfig {
  ticker: string;
  entryPrice: number;
  stopPrice: number;
  atr: number;
  regime: string;
  nPaths: number;        // default 500
  horizonDays: number;   // default 7
  adversarialBias: number; // 0 = neutral, 1 = maximum adversarial (default 0.6)
}

// Path generator:
// 1. Compute base daily volatility = ATR / entryPrice
// 2. Adversarial bias: sample drift from lower tail of historical drift distribution
//    for this regime (e.g. in trending regime, adversarial = use ranging-regime drift)
// 3. For each path: geometric Brownian motion with adversarial drift + fat-tail jumps
//    (add occasional -2σ to -4σ jump events at rate proportional to adversarialBias)
// 4. Count paths where min(path) <= stopPrice within horizonDays

function runAdversarialTest(config: StressTestConfig): StressTestResult {
  let stopHits = 0;
  for (let i = 0; i < config.nPaths; i++) {
    const path = generateAdversarialPath(config);
    if (Math.min(...path) <= config.stopPrice) stopHits++;
  }
  return {
    stopHitProbability: stopHits / config.nPaths,
    gate: stopHits / config.nPaths > 0.25 ? 'FAIL' : 'PASS',
    pathsRun: config.nPaths,
  };
}
```

### Gate Thresholds
```typescript
const STRESS_GATE = {
  autoYesMaxStopProb: 0.25,   // Auto-Yes blocked if >25% of adversarial paths hit stop
  conditionalMaxStopProb: 0.40, // Conditional blocked if >40%
  // NOTE: these are adversarially biased probabilities, not real probabilities
  // They are intentionally conservative
};
```

### Performance Consideration
- 500 paths × 7 days = 3,500 price points. Pure TS, no dependencies needed. Runs in < 50ms.
- Run on-demand when user is reviewing a Conditional or Auto-Yes trade
- Do NOT run during the nightly scan (too slow for 268 tickers)
- Cache result for 4 hours per ticker

---

## Phase 5 — Information-Theoretic Signal Pruning

### Overview

A one-time (then periodic) analysis that measures how much **unique information** each of the 7 signal layers contributes, controlling for what other layers already tell you. Produces a signal dependency graph and a pruning recommendation. Does not auto-modify NCS — produces a report for human review.

### New Files to Create
- `lib/prediction/mutual-information.ts` — MI computation (discretise signals → compute MI matrix)
- `app/api/prediction/signal-audit/route.ts` — runs MI analysis across historical scan data
- `app/signal-audit/page.tsx` — analysis results page with dependency graph
- `prisma/migrations/signal_audit` — new table: `SignalAuditResult`

### Files to Read First
- `lib/scan-engine.ts` (read only — understand signal output format)
- `lib/dual-score.ts` (read only — understand how signals feed NCS)
- `CLAUDE.md`

### MI Analysis Approach
```typescript
// 1. Pull last N scan results from DB (target: 500+ ticker-date observations)
// 2. For each pair of signals (i, j): compute mutual information
//    MI(X;Y) = Σ p(x,y) log(p(x,y) / p(x)p(y))
//    Discretise continuous signals into 10 bins (equal-frequency binning)
// 3. Compute conditional MI: MI(signal_i ; outcome | all other signals)
//    This tells you: what does signal_i add that the others don't already know?
// 4. Output: 7×7 MI matrix + conditional MI vector (one value per signal)

// Interpretation thresholds:
// condMI < 0.05 → signal is nearly redundant given the others
// condMI 0.05–0.15 → marginal contribution
// condMI > 0.15 → genuinely independent information (keep and weight heavily)
```

### Output Report
The audit page shows:
- Heatmap of pairwise MI (high MI = redundant pair)
- Bar chart of conditional MI per signal
- Recommendation table: KEEP / INVESTIGATE / REDUNDANT per signal
- If two signals are highly correlated (MI > 0.7), suggest merging into one interaction feature

### Sacred File Prohibition
> ⛔ This phase is ANALYSIS ONLY. No changes to sacred files or NCS construction. Output is a report for manual review. Any NCS weight changes resulting from the analysis are applied via the Phase 3 meta-model, not by modifying dual-score.ts.

---

## Phase 6 — Immune System / Market Danger Memory

### Overview

Maintain a rolling **threat library** of historical market conditions that preceded your worst drawdowns and signal failures. When current conditions pattern-match to the library, automatically tighten risk gates. This operates orthogonally to the signal stack — it is not predicting price, it is recognising dangerous *environments*.

### New Files to Create
- `lib/prediction/threat-library.ts` — stores and queries historical danger fingerprints
- `lib/prediction/environment-encoder.ts` — converts current market state to a feature vector
- `lib/prediction/danger-matcher.ts` — cosine similarity / DTW distance scoring
- `app/api/prediction/danger-level/route.ts` — returns current danger level 0–100
- `components/DangerLevelIndicator.tsx` — ambient UI indicator (colour-coded border/badge)
- `prisma/migrations/threat_library` — new table: `ThreatLibraryEntry`

### Files to Read First
- `lib/regime-detector.ts` (read only)
- `lib/risk-gates.ts` (read only — understand existing gate structure)
- `CLAUDE.md`

### Environment Feature Vector
```typescript
interface MarketEnvironment {
  vix: number;
  vixChange5d: number;
  vixTermStructureSlope: number;  // VIX3M - VIX (contango/backwardation)
  spyMomentum20d: number;
  spyVolatilityRealised10d: number;
  advanceDeclineRatio: number;
  highYieldSpread: number;        // HYG proxy
  drsScore: number;
  averagePortfolioCorrelation: number;
  daysInCurrentRegime: number;
}
```

### Threat Matching
```typescript
// When a past trade resulted in: stop hit within 3 days, OR -2R or worse outcome
// → encode the market environment at that time → add to threat library

// At scan time:
// 1. Encode current environment as vector
// 2. Compute cosine similarity with each threat library entry
// 3. dangerScore = max similarity across top-5 closest threats (weighted by severity)
// 4. If dangerScore > 0.75: enter "immune alert" — tighten all risk gates by 20%
//    (implemented by reducing max open risk, not by changing risk-gates.ts)
```

### Bootstrap Strategy (no real losses yet)
- Pre-populate threat library with known historical danger environments from public data:
  - March 2020 (VIX spike, correlation spike, ADR collapse)
  - August 2015 (flash crash pattern)
  - October 2022 (rate shock, sustained drawdown)
- Encode these from Yahoo Finance / FRED data at system setup
- As real losses accumulate, they are automatically added to the library

---

## Phase 7 — Lead-Lag Cross-Asset Graph

### Overview

Build a **directional influence graph** across your 268-ticker universe plus key macro proxies. When an upstream asset moves, tickers it leads receive a signal boost or penalty before price confirms. This is the most infrastructure-intensive phase and should only be started after Phases 1–6 are stable.

### New Files to Create
- `lib/prediction/lead-lag-analyser.ts` — computes pairwise lead-lag relationships
- `lib/prediction/lead-lag-graph.ts` — stores and queries the directional graph
- `app/api/prediction/lead-lag/route.ts` — returns upstream assets for a given ticker
- `components/LeadLagPanel.tsx` — shows which upstream assets are currently moving
- `prisma/migrations/lead_lag` — new tables: `LeadLagEdge`, `LeadLagSignal`

### Files to Read First
- `lib/scan-engine.ts` (read only)
- `lib/yahoo-finance.ts` (read only — understand data fetch patterns)
- `CLAUDE.md`

### Lead-Lag Computation
```typescript
// Cross-correlation with lag: for each pair (A, B), compute correlation between
// today's return of A and B's return k days later, for k = 1..5
// If corr(A[t], B[t+k]) is significantly positive for k=1 or k=2:
// → A is a leading indicator of B

// Key macro proxies to always include as potential upstream nodes:
const MACRO_PROXIES = [
  'HYG',   // high-yield credit → leads equities by 1-2d in risk-off
  'TLT',   // long bonds → leads growth stocks
  'GLD',   // gold → leads defensive sectors
  'UUP',   // dollar → leads commodity exporters (inverse)
  'XLF',   // financials → leads broad market
  'CPER',  // copper → leads industrials by 3-5d
];

// Graph edges: store only statistically significant relationships
// (p-value < 0.05 after Bonferroni correction for multiple comparisons)
// Recompute graph weekly (Sunday nightly pipeline)
```

### Usage at Scan Time
```typescript
// For each candidate ticker T:
// 1. Find upstream nodes U where edge (U → T) exists with lag ≤ 2 days
// 2. Check if each U has moved significantly in the last 2 days (> 1 ATR)
// 3. If U moved positively → add lead-lag boost to NCS (+5 to +10 points)
//    If U moved negatively → add lead-lag penalty (-5 to -15 points)
// This is applied as a final NCS adjustment, logged separately for audit
```

---

## Implementation Order Summary

| Phase | Feature | Complexity | Data Required | ETA |
|-------|---------|------------|---------------|-----|
| 1 | Conformal Prediction Intervals | Medium | Synthetic bootstrap | Week 1–2 |
| 2 | Failure Mode Scoring | Medium | Current signals | Week 3 |
| 3 | Dynamic Signal Weighting | Medium-High | Regime + VIX data | Week 4–5 |
| 4 | Adversarial Stress Test | Medium | ATR + stop data | Week 6 |
| 5 | Signal Pruning Audit | Low | Historical scan logs | Week 7 |
| 6 | Immune System Memory | High | Synthetic + accumulating | Week 8–10 |
| 7 | Lead-Lag Graph | High | 6mo+ historical OHLCV | Week 11–14 |

---

## Global Rules for All Claude Code Prompts

Include these instructions at the top of every prompt you send to Claude Code:

```
BEFORE WRITING ANY CODE:
1. Read CLAUDE.md in full
2. Read every file listed under "Files to Read First"
3. Understand existing patterns before creating new ones

SACRED FILES — NEVER MODIFY UNDER ANY CIRCUMSTANCE:
- stop-manager.ts
- position-sizer.ts
- risk-gates.ts
- regime-detector.ts
- dual-score.ts
- scan-engine.ts

GENERAL CONSTRAINTS:
- Match existing TypeScript patterns and naming conventions
- Never hardcode values that belong in constants files
- All thresholds go in a dedicated *-thresholds.ts or constants file
- Server-side enforcement must mirror any UI enforcement
- Every new API route follows existing auth middleware patterns
- Every new Prisma model follows existing schema conventions
- All new components use existing design system tokens
```
