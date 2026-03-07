# HybridTurtle — Frontier Expansion
## Phase 8–14 Implementation Roadmap

> **Prerequisite:** Phases 1–7 complete and stable  
> **Stack:** Next.js 14 · TypeScript · Prisma/SQLite · Trading 212 API · Yahoo Finance  
> **Sacred files (never modify):** `stop-manager.ts` · `position-sizer.ts` · `risk-gates.ts` · `regime-detector.ts` · `dual-score.ts` · `scan-engine.ts`  
> **Pace:** One Claude Code prompt per session, sequentially ordered

---

## Phase 8 — Graph Neural Network on Lead-Lag Graph

### Overview

Phase 7 built a static lead-lag graph with cosine similarity edges. This phase replaces the simple edge-lookup with a **Graph Neural Network (GNN)** that learns to propagate signals across the graph. Instead of asking "is an upstream node moving?", the GNN learns *which propagation patterns* historically predict breakout success — capturing second and third-order effects (e.g. copper moves → industrials move → capital goods move → specific ticker moves).

### New Files to Create
- `lib/prediction/gnn/graph-builder.ts` — converts lead-lag edges + current prices into adjacency matrix + node feature matrix
- `lib/prediction/gnn/message-passing.ts` — pure TS implementation of 2-layer GraphSAGE (no external ML deps)
- `lib/prediction/gnn/gnn-trainer.ts` — offline training loop using historical scan + outcome data
- `lib/prediction/gnn/gnn-inference.ts` — at scan time: run forward pass, return graph-enhanced score per ticker
- `app/api/prediction/gnn-score/route.ts` — returns GNN-enhanced score for a ticker
- `components/GraphScorePanel.tsx` — shows graph influence visualisation (upstream nodes, signal flow)
- `prisma/migrations/gnn` — tables: `GNNModelWeights`, `GNNInferenceLog`

### Files to Read First
- `lib/prediction/lead-lag-graph.ts` (read — GNN replaces its inference layer)
- `lib/prediction/conformal-calibrator.ts` (read — wrap GNN output in conformal interval)
- `prisma/schema.prisma` (read/extend)
- `CLAUDE.md`

### GraphSAGE Implementation (pure TypeScript, no deps)
```typescript
// Node features per ticker (at scan time):
interface NodeFeatures {
  ncs: number;                    // current NCS (normalised 0–1)
  priceReturn1d: number;          // 1-day return
  priceReturn5d: number;          // 5-day return
  volumeRatio: number;            // vs 20d avg
  atrPercentile: number;          // ATR percentile in 1yr distribution
  regimeScore: number;            // DRS output
  failureModeMax: number;         // highest FM score from Phase 2
}

// Message passing (2 layers):
// Layer 1: each node aggregates features from its 1-hop neighbours
//   h_v^1 = ReLU(W1 · MEAN([h_u for u in neighbours(v)] ++ h_v^0))
// Layer 2: aggregate again from updated 1-hop
//   h_v^2 = ReLU(W2 · MEAN([h_u^1 for u in neighbours(v)] ++ h_v^1))
// Output: scalar score per node (graph-enhanced NCS adjustment)
//   score_v = sigmoid(W_out · h_v^2)

// W1, W2, W_out are learned weight matrices (7×16, 16×8, 8×1)
// Total parameters: ~200 — lightweight, trains on CPU in seconds
```

### Training Target
- Label: did this ticker achieve ≥ 1.5R within 15 days? (binary)
- Loss: binary cross-entropy
- Training data: historical scan outputs with Phase 2–7 features + outcome labels
- Retrain: weekly (Sunday nightly pipeline)
- Minimum training samples before GNN activates: 150

### Integration with NCS Pipeline
```typescript
// Final NCS adjustment:
// adjustedNCS = conformalWrapped(
//   metaWeighted(rawNCS) + gnnAdjustment * GNN_WEIGHT_FACTOR
// )
// GNN_WEIGHT_FACTOR = 0.10 initially (10% influence), increase as model matures
// Store gnnAdjustment separately in scan log for audit
```

### Sacred File Prohibition
> ⛔ DO NOT modify sacred files. GNN is an additional scoring layer applied after all existing scoring completes.

---

## Phase 9 — Online Bayesian Belief Updating

### Overview

Currently, signal weights and thresholds are updated in batch (weekly/monthly retraining). This phase adds a **continuous Bayesian update mechanism** — every trade outcome, every signal confirmation or failure, immediately nudges the system's beliefs about signal reliability. No waiting for a retraining cycle. The system learns in real time, one observation at a time.

### New Files to Create
- `lib/prediction/bayesian/belief-state.ts` — maintains Beta distribution parameters per signal per regime
- `lib/prediction/bayesian/bayesian-updater.ts` — updates beliefs given new evidence
- `lib/prediction/bayesian/belief-informed-weights.ts` — converts current beliefs to weight adjustments
- `app/api/prediction/beliefs/route.ts` — returns current belief state (for audit/display)
- `components/BeliefStatePanel.tsx` — shows posterior distributions per signal as sparklines
- `prisma/migrations/belief_state` — table: `SignalBeliefState`

### Files to Read First
- `lib/prediction/signal-weight-meta-model.ts` (read — Bayesian updates feed into this)
- `lib/prediction/conformal-calibrator.ts` (read — parallel updating pattern)
- `CLAUDE.md`

### Bayesian Update Model
```typescript
// Each signal in each regime has a Beta(α, β) prior
// α = pseudo-count of "signal predicted correctly"
// β = pseudo-count of "signal predicted incorrectly"
// Prior: Beta(2, 2) — weakly uninformative, centred at 0.5

interface SignalBelief {
  signal: string;       // 'adx' | 'hurst' | 'bis' | etc.
  regime: string;
  alpha: number;        // successes + prior
  beta: number;         // failures + prior
  mean: number;         // alpha / (alpha + beta) — current best estimate of P(signal works)
  credibleIntervalLow: number;   // 5th percentile of Beta distribution
  credibleIntervalHigh: number;  // 95th percentile
  nObservations: number;
}

// After each trade closes:
// If signal fired AND trade was profitable: alpha += 1
// If signal fired AND trade was a loss:    beta += 1
// If signal did NOT fire: no update (can't learn from absence yet)

// Belief-informed weight adjustment:
// weight_i = baseWeight_i * (belief_i.mean / 0.5)
// Clamp to [0.5 * baseWeight, 2.0 * baseWeight] to prevent runaway suppression
```

### Regime-Specific Beliefs
- Maintain separate Beta distributions per (signal, regime) pair
- 7 signals × 4 regimes = 28 Beta distributions total
- On regime transition: switch to that regime's belief state immediately
- This means ADX can be trusted in TRENDING but downweighted in RANGING automatically, based on *actual observed outcomes* rather than rules

### UI: Belief Dashboard
- `BeliefStatePanel` shows a 7×4 grid (signal × regime)
- Each cell: small Beta distribution curve, mean ± CI, observation count
- Highlight cells where CI is tight and mean is far from 0.5 (high-confidence beliefs)
- Flag cells where CI is very wide (insufficient data — treat as prior)

---

## Phase 10 — Meta-Reinforcement Learning for Trade Management

### Overview

Currently trade management (when to exit, whether to pyramid, whether to tighten stops) follows fixed rules. This phase trains a **Meta-RL agent** that learns *policies* for trade management decisions — not by optimising a single strategy, but by learning to adapt quickly to new market conditions using experience from past trade episodes. The agent observes current trade state and recommends actions, which the human approves before execution.

### New Files to Create
- `lib/prediction/meta-rl/trade-state-encoder.ts` — encodes open trade state as observation vector
- `lib/prediction/meta-rl/policy-network.ts` — small MLP policy network (pure TS)
- `lib/prediction/meta-rl/episode-memory.ts` — stores trade episodes for training
- `lib/prediction/meta-rl/maml-trainer.ts` — Model-Agnostic Meta-Learning training loop
- `app/api/prediction/trade-recommendation/route.ts` — returns recommended action for open trade
- `components/TradeAdvisorPanel.tsx` — shows agent recommendation with confidence + reasoning
- `prisma/migrations/meta_rl` — tables: `TradeEpisode`, `PolicyVersion`

### Files to Read First
- `lib/stop-manager.ts` (read only — understand stop management state)
- `lib/position-sizer.ts` (read only — understand pyramiding logic)
- `lib/prediction/adversarial-simulator.ts` (read — used to augment episode training data)
- `CLAUDE.md`

### Observation Vector (trade state at each daily step)
```typescript
interface TradeObservation {
  // Position state
  rMultipleCurrent: number;       // current unrealised R
  daysInTrade: number;
  stopDistanceAtr: number;        // current stop distance in ATR units
  pyramidLevel: number;           // 0, 1, or 2
  
  // Market state  
  regimeScore: number;
  vixPercentile: number;
  volumeTrend3d: number;          // volume expanding or contracting
  priceVsEntryPercent: number;
  
  // Signal state
  currentNCS: number;             // NCS at today's rescan
  beliefWeightedNCS: number;      // Phase 9 belief-adjusted NCS
  fm1Score: number;               // breakout failure risk (Phase 2)
  fm4Score: number;               // regime flip risk (Phase 2)
  
  // Risk state
  openRiskPercent: number;        // total portfolio open risk %
  correlationWithPortfolio: number;
}
```

### Action Space
```typescript
type TradeAction =
  | 'HOLD'               // do nothing
  | 'TIGHTEN_STOP'       // move stop up to recent swing low
  | 'TRAIL_STOP_ATR'     // trail stop to 2× ATR below current price
  | 'PYRAMID_ADD'        // add to position (if pyramiding criteria met)
  | 'PARTIAL_EXIT_25'    // take 25% off the table
  | 'PARTIAL_EXIT_50'    // take 50% off the table
  | 'FULL_EXIT'          // close entire position
```

### MAML Training Strategy
```typescript
// Meta-learning: train a policy that can adapt in a few steps to new market episodes
// Each "task" = one historical trade episode (entry → exit)
// Inner loop: fine-tune policy on this episode (5 gradient steps)
// Outer loop: update meta-weights so fine-tuning generalises across episodes

// Bootstrap: generate synthetic episodes using adversarial simulator (Phase 4)
// This provides hundreds of training episodes before real trade history accumulates

// Reward function:
// +R_multiple_at_exit          (final outcome)
// +0.1 per day in profitable trade (reward patience)
// -0.5 for stop hit within 3 days (penalise poor entry survival)
// -0.2 for unnecessary churn (FULL_EXIT followed by missed continuation)
```

### Human-in-the-Loop Design
- Agent recommendations appear in `TradeAdvisorPanel` as suggestions only
- Each recommendation shows: action, confidence %, key reason (top 2 observation features driving the recommendation)
- Human approves or overrides — override is logged and fed back as training signal
- This creates a **human feedback loop** that improves the policy over time (RLHF-lite)

---

## Phase 11 — Fractional Kelly Position Sizing with Uncertainty

### Overview

Your current position sizing uses fixed-fraction risk (2% per trade). Kelly Criterion theoretically maximises long-run growth rate, but full Kelly is too aggressive and assumes perfect probability estimates. This phase implements **Fractional Kelly with uncertainty penalty** — sizing positions using your *entire probability stack* (conformal intervals, belief state, GNN confidence) rather than a flat percentage.

### New Files to Create
- `lib/prediction/kelly/kelly-calculator.ts` — core fractional Kelly computation
- `lib/prediction/kelly/uncertainty-penalty.ts` — discounts Kelly fraction based on confidence width
- `lib/prediction/kelly/portfolio-kelly.ts` — multi-position Kelly with correlation adjustment
- `app/api/prediction/kelly-size/route.ts` — returns Kelly-adjusted position size
- `components/KellySizePanel.tsx` — shows Kelly fraction + uncertainty breakdown

### Files to Read First
- `lib/position-sizer.ts` (read only — current sizing logic, must not be modified)
- `lib/prediction/conformal-calibrator.ts` (read — interval width feeds uncertainty penalty)
- `lib/prediction/bayesian/belief-state.ts` (read — belief certainty feeds Kelly)
- `lib/risk-gates.ts` (read only — Kelly output must respect all existing gates)
- `CLAUDE.md`

### Kelly Calculation
```typescript
// Standard Kelly: f* = (p × b - q) / b
// where p = P(win), b = win/loss ratio (R-multiple ratio), q = 1 - p

// Inputs from existing system:
// p: derived from historical win rate × belief-weighted NCS percentile
// b: average winner R-multiple / average loser R-multiple (from EV tracker)

// Uncertainty penalty — discount Kelly fraction based on confidence:
// uncertaintyPenalty = intervalWidth / MAX_EXPECTED_WIDTH  (from Phase 1)
// beliefPenalty = 1 - beliefState.mean (wider CI = less trust)
// gnnPenalty = 1 - gnnConfidence (from Phase 8)

// adjustedKelly = baseKelly
//   × (1 - 0.3 × uncertaintyPenalty)   // conformal interval width penalty
//   × (1 - 0.2 × beliefPenalty)         // Bayesian belief uncertainty penalty
//   × (1 - 0.1 × gnnPenalty)            // GNN confidence penalty

// Fractional Kelly: use 25% of adjustedKelly (quarter-Kelly)
// This gives ~80% of Kelly's long-run growth with dramatically lower drawdowns

// Hard caps (must respect sacred position-sizer.ts limits):
// fractionKelly = Math.min(adjustedKelly * 0.25, MAX_RISK_PER_TRADE)
// The Kelly output is a SUGGESTION — it feeds the position sizer as an input,
// never overriding its hard risk gate outputs
```

### Portfolio Kelly (multi-position correlation adjustment)
```typescript
// When multiple correlated positions are open, individual Kelly fractions
// must be scaled down to account for correlation
// Adjusted fraction_i = fraction_i × (1 - avgCorrelationWithPortfolio × 0.5)
// This prevents over-concentration even when individual trades look attractive
```

---

## Phase 12 — Order Flow Imbalance Signal (VPIN Approximation)

### Overview

Order flow imbalance — the ratio of aggressive buying to selling — is a leading indicator of short-term momentum that is more predictive than price alone. This phase implements a **VPIN (Volume-Synchronized Probability of Informed Trading) approximation** using OHLCV data, adding a genuine microstructure signal that most retail systems don't have.

### New Files to Create
- `lib/signals/vpin-calculator.ts` — computes VPIN approximation from OHLCV
- `lib/signals/order-flow-imbalance.ts` — tick rule approximation of buy/sell volume
- `app/api/signals/vpin/route.ts` — returns VPIN score for a ticker
- `components/VPINBadge.tsx` — shows order flow imbalance as a directional indicator
- `prisma/migrations/vpin` — table: `VPINHistory`

### Files to Read First
- `lib/scan-engine.ts` (read only — understand how new signals are added)
- `lib/yahoo-finance.ts` (read only — OHLCV fetch pattern)
- `lib/dual-score.ts` (read only — understand how to surface new signal in scoring)
- `CLAUDE.md`

### VPIN Approximation Algorithm
```typescript
// True VPIN requires tick data. This approximation uses intraday OHLCV (15min bars)
// from Yahoo Finance's intraday endpoint

// Step 1: Classify each bar as buy-initiated or sell-initiated using the Tick Rule
// If close > open → buy volume = volume × (close - low) / (high - low)
// If close < open → sell volume = volume × (high - close) / (high - low)
// If close == open → split 50/50

// Step 2: Compute Volume Bucket imbalance
// Group bars into equal-volume buckets (bucket size = ADV / 50)
// For each bucket: OFI = |buyVol - sellVol| / (buyVol + sellVol)

// Step 3: VPIN = rolling mean of OFI over last N buckets (N = 50)
// VPIN ∈ [0, 1]: 0 = perfectly balanced, 1 = entirely one-directional

// Step 4: Directional OFI (more useful than VPIN alone)
// DOFI = (buyVol - sellVol) / totalVol over last 20 buckets
// DOFI > +0.3 → strong buying pressure (bullish signal)
// DOFI < -0.3 → strong selling pressure (bearish — suppress trade)

// Integration: add DOFI as an 8th signal layer
// In scan-engine: read DOFI as a modifier (does NOT require changing sacred files)
// Surface as bonus/penalty in the API layer above NCS
```

### Data Requirements
- Yahoo Finance 15-minute intraday data (available for free for last 60 days)
- Compute VPIN nightly during pre-cache phase for all universe tickers
- Cache in DB — don't recompute at scan time

---

## Phase 13 — Multi-Source Sentiment Fusion

### Overview

Aggregate sentiment signals from multiple free/cheap sources into a single **Sentiment Composite Score (SCS)** per ticker. Sentiment leads price at breakouts — extreme positive sentiment with rising price confirms breakouts; divergence (rising price, falling sentiment) warns of false breaks.

### New Files to Create
- `lib/signals/sentiment/news-sentiment.ts` — fetch + score recent news headlines
- `lib/signals/sentiment/reddit-sentiment.ts` — WSB/investing subreddit mention scoring
- `lib/signals/sentiment/analyst-revision.ts` — detect recent EPS/PT estimate revisions
- `lib/signals/sentiment/sentiment-fusion.ts` — combines sources into SCS
- `app/api/signals/sentiment/route.ts` — returns SCS for a ticker
- `components/SentimentPanel.tsx` — source-by-source sentiment breakdown
- `prisma/migrations/sentiment` — table: `SentimentHistory`

### Files to Read First
- `lib/scan-engine.ts` (read only)
- `lib/prediction/threat-library.ts` (read — sentiment feeds danger detection)
- `CLAUDE.md`

### Data Sources (all free/low-cost)

**1. News Headlines — Yahoo Finance RSS**
```typescript
// Yahoo Finance provides free RSS feeds per ticker
// URL: https://feeds.finance.yahoo.com/rss/2.0/headline?s={TICKER}
// Fetch last 20 headlines. Score each using a simple financial sentiment lexicon
// (Loughran-McDonald word list — public domain, embed in constants file)
// headline_score = (positive_words - negative_words) / total_financial_words
// SCS_news = mean(headline_scores over last 5 days)
```

**2. Analyst Estimate Revisions — Yahoo Finance Summary**
```typescript
// Already partially available via Yahoo Finance API
// Detect: has EPS estimate been revised up/down in last 30 days?
// Has price target been revised?
// revision_score = (upward_revisions - downward_revisions) / total_analysts
// High positive score = smart money is upgrading expectations
```

**3. Short Interest**
```typescript
// Yahoo Finance provides short % of float
// High short interest + rising price = potential squeeze (bullish)
// High short interest + falling price = distribution (bearish)
// short_score = shortInterest > 0.20 && priceReturn5d > 0 ? +20 : 
//               shortInterest > 0.20 && priceReturn5d < 0 ? -20 : 0
```

### Sentiment Fusion
```typescript
// SCS = weightedSum([
//   SCS_news × 0.35,
//   revision_score × 0.40,    // analyst revisions are highest quality
//   short_score × 0.25
// ]) normalised to 0–100

// Sentiment-Price Divergence detector:
// divergence = SCS trending down while price trending up
// If divergence detected → add FM1 (breakout failure) penalty of +15
```

---

## Phase 14 — Causal Invariance Filter

### Overview

This is the most mathematically advanced phase. Most ML signals capture correlations that **break when the environment shifts**. Invariant Risk Minimisation (IRM) identifies which signal features are *causally stable* — they predict outcomes across all market regimes, not just the current one. Features that only work in trending markets get flagged as "environmentally dependent" and down-weighted during regime transitions.

### New Files to Create
- `lib/prediction/causal/environment-partitioner.ts` — partitions historical data into regime environments
- `lib/prediction/causal/irm-trainer.ts` — IRM training loop (finds invariant features)
- `lib/prediction/causal/invariance-scores.ts` — scores each signal by causal invariance
- `lib/prediction/causal/invariant-ncs.ts` — NCS reweighted by invariance scores
- `app/api/prediction/invariance/route.ts` — returns invariance scores per signal
- `app/causal-audit/page.tsx` — audit page showing which features are causal vs spurious
- `prisma/migrations/invariance` — table: `InvarianceAuditResult`

### Files to Read First
- `lib/prediction/signal-weight-meta-model.ts` (read — IRM replaces/enhances this)
- `lib/regime-detector.ts` (read only — regimes define IRM environments)
- `lib/prediction/bayesian/belief-state.ts` (read — complement to IRM)
- `CLAUDE.md`

### IRM Algorithm (simplified for pure TS)
```typescript
// IRM intuition: a feature is "invariant" if the optimal linear predictor
// using that feature is the SAME across all environments (regimes)

// Environments: partition historical scan data by regime label
// E = { TRENDING_data, RANGING_data, VOLATILE_data, TRANSITION_data }

// For each signal s:
// 1. Fit a linear predictor: outcome ~ β_s × signal_s in each environment
// 2. Compute variance of β_s across environments
//    low variance = β_s is similar in all regimes = signal is invariant (causal)
//    high variance = β_s changes across regimes = signal is spurious/environmental

// invarianceScore_s = 1 / (1 + variance(β_s across environments))
// Score ∈ (0, 1]: 1.0 = perfectly invariant, near 0 = highly regime-dependent

// Apply to NCS:
// invariantNCS = Σ (invarianceScore_i × metaWeight_i × signal_i)
// This is a further refinement on top of Phase 3 meta-weights
```

### Invariance-Aware Decision Logic
```typescript
// New concept: "Regime Transition Penalty"
// When DRS detects a regime transition (current regime ≠ last regime):
//   - Temporarily down-weight all signals with invarianceScore < 0.4
//   - These are "environmentally dependent" signals that haven't yet
//     recalibrated to the new regime
//   - Weight returns to normal after 5 trading days in new regime

// This prevents the common failure mode of momentum signals giving
// false positives immediately after a regime shift
```

### Audit Page
- Show each signal's invariance score as a bar: 0 (fully spurious) → 1 (fully causal)
- Show β_s per regime as a small multiples chart (how much does the predictive relationship vary?)
- Flag signals where invariance score drops sharply over time (degradation alert)
- Recommend: signals with invariance < 0.3 should be removed or made conditional

---

## Phase Summary

| Phase | Feature | Core Concept | Key Benefit |
|-------|---------|--------------|-------------|
| 8 | GNN on Lead-Lag Graph | Graph neural network | Captures 2nd/3rd order cross-asset propagation |
| 9 | Online Bayesian Updating | Beta distribution beliefs | Real-time signal reliability tracking |
| 10 | Meta-RL Trade Management | MAML policy learning | Adaptive exit/pyramid decisions |
| 11 | Fractional Kelly Sizing | Uncertainty-penalised Kelly | Optimal growth rate with confidence discounting |
| 12 | VPIN / Order Flow | Microstructure signal | Leading indicator before price confirms |
| 13 | Sentiment Fusion | Multi-source NLP | Sentiment-price divergence detection |
| 14 | Causal Invariance Filter | IRM feature selection | Identifies signals stable across all regimes |

---

## Recommended Build Order

Phases 11 and 12 are the highest immediate-value additions:

- **Phase 11 (Kelly)** can be built now — all inputs exist in Phases 1, 8, 9
- **Phase 12 (VPIN)** is self-contained and adds a genuinely novel signal layer
- **Phase 9 (Bayesian)** should come before Phase 10 (Meta-RL needs belief state as input)
- **Phase 14 (IRM)** requires ~6 months of multi-regime data to produce reliable invariance scores — start collecting now, train later

---

## Global Rules for All Claude Code Prompts

Copy-paste verbatim at the top of every Claude Code session:

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
- New signal layers are POST-PROCESSING only — never modify how signals are computed
```
