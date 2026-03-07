# Research & Validation Upgrade — Implementation Roadmap

> Working document for continuing the research-driven analytics workstream across sessions.
> Last updated: 6 March 2026

---

## Objective

Turn HybridTurtle from a feature-rich trading engine into a **measurable, research-driven system** that can prove which rules add value. Every major filter, score, and gate should have data showing whether it improves outcomes.

---

## Current Status

**Phase 1 (Foundation) — COMPLETE**

The research dataset, analytics services, UI pages, benchmarking mode, rule audit, first pruning pass, and test coverage are all implemented and passing (36 test files, 615 tests).

---

## Completed Items

| # | Deliverable | Key Files |
|---|-------------|-----------|
| 1 | **Candidate Outcome Dataset** — one row per ticker per scan, all pipeline data | `candidate-outcome.ts`, `CandidateOutcome` model |
| 2 | **Forward Outcome Enrichment** — 5d/10d/20d returns, MFE/MAE, R-thresholds, stop-hit | `candidate-outcome-enrichment.ts` |
| 3 | **Filter Scorecard** — passed vs blocked outcomes per pipeline rule | `filter-scorecard.ts`, `/filter-scorecard` page |
| 4 | **Score Validation** — NCS/FWS/BQS band analysis + monotonicity tests + Auto-action comparison | `score-validation.ts`, `/score-validation` page |
| 5 | **Execution Audit** — model vs actual fill, slippage, stop/size drift, anti-chase compliance | `execution-audit.ts`, `/execution-audit` page |
| 6 | **Capital Allocation Score** — portfolio-aware ranking with 8-component breakdown | `allocation-score.ts`, `/api/plan/allocation-score` |
| 7 | **CORE_LITE Benchmark Mode** — stripped scan/backtest for measuring overlay value-add | `scan-engine.ts` (scanMode param), `/api/backtest?mode=CORE_LITE` |
| 8 | **Backtest Comparison** — side-by-side FULL vs CORE_LITE with delta metrics | `/api/backtest/compare` |
| 9 | **Rule Inventory** — 82 rules documented with overlaps, thresholds, file locations | `reports/rule-inventory.json` |
| 10 | **Rule Overlap Analysis** — 13 overlap pairs, verdicts (8 KEEP, 2 RETEST, 2 REDUCE, 1 REMOVE) | `reports/rule-overlap-analysis.json` |
| 11 | **First Pruning Pass** — ALLOC-EARNINGS removed (triple-count), FWS vol-shock 20→10 (double-count) | `allocation-score.ts`, `dual-score.ts` |
| 12 | **Research Refresh Job** — 5-step idempotent pipeline for backfilling and enriching data | `src/cron/research-refresh.ts`, `research-refresh-task.bat` |
| 13 | **Optimized Indexes** — 6 compound indexes for analytics query patterns | 4 analytics migrations |
| 14 | **Research Loop Tests** — 41 tests covering the full research pipeline | `research-loop.test.ts` |
| 15 | **Score Backfill Service** — populates BQS/FWS/NCS on CandidateOutcome from ScoreBreakdown | `score-backfill.ts` |
| 16 | **Plan Page Allocation Breakdown** — expandable score component display per READY candidate | `ReadyCandidates.tsx` updated |

---

## Next Tasks

### High priority (enable data collection)

- [ ] **Run scans** to populate CandidateOutcome records (currently 1156 rows, 1000 scored)
- [ ] **Wait 8+ days** then run `research-refresh-task.bat` to enrich forward outcomes
- [ ] **Register research-refresh as Task Scheduler job** (daily, after nightly completes)
- [ ] **Place first trades** through the system to populate trade linkage + execution audit data

### Medium priority (data analysis)

- [ ] **Analyze filter scorecard** results once enrichment data is available — which filters actually add edge?
- [ ] **Analyze score validation** — is NCS monotonically predictive? Does Auto-Yes outperform Conditional?
- [ ] **Run `/api/backtest/compare`** to compare FULL vs CORE_LITE signal quality
- [ ] **Test OVERLAP-01 (ADX triple layer)** with score validation data — verify FWS-MARGINAL is not over-penalizing ADX 20–25
- [ ] **Test OVERLAP-05 (anti-chase + FWS extension)** — measure co-occurrence rate via rule overlap API

### Lower priority (improvements)

- [ ] **Populate BQS/FWS/NCS inline during scan** (currently null, backfilled from ScoreBreakdown later)
- [ ] **Add FX-aware allocation score** — current `/api/plan/allocation-score` uses fxToGbp=1
- [ ] **Add allocation score to TodayPanel** — show breakdown for the "best" candidate
- [ ] **Build a combined analytics dashboard** — single page with filter scorecard + score validation + execution audit summaries

---

## Key Files & Modules

### Services (src/lib/)

| File | Purpose |
|------|---------|
| `candidate-outcome.ts` | Extract + persist candidate outcome records from scans |
| `candidate-outcome-enrichment.ts` | Enrich with forward returns from Yahoo prices |
| `filter-scorecard.ts` | Aggregate outcomes by pipeline rule (passed vs blocked) |
| `score-validation.ts` | Analyze NCS/FWS/BQS band outcomes + monotonicity |
| `execution-audit.ts` | Compare model plan vs actual fill |
| `allocation-score.ts` | Portfolio-aware capital allocation ranking |
| `score-backfill.ts` | Populate scores from ScoreBreakdown → CandidateOutcome |
| `rule-overlap.ts` | Compute co-occurrence between filter decisions |
| `filter-attribution.ts` | Per-candidate filter pass/fail tracking |
| `score-tracker.ts` | Per-snapshot BQS/FWS/NCS component storage |
| `benchmark-scan.ts` | MA200-only stripped scan |

### API Routes (src/app/api/analytics/)

| Route | Method | Purpose |
|-------|--------|---------|
| `/analytics/candidate-outcomes` | GET/POST | Query outcomes, trigger enrichment |
| `/analytics/filter-scorecard` | GET | Filter scorecard report |
| `/analytics/score-validation` | GET/POST | Score band analysis, trigger score backfill |
| `/analytics/execution-audit` | GET | Execution drag report |
| `/analytics/execution-drag` | GET | Legacy execution drag stats |
| `/analytics/filter-attribution` | GET/POST | Filter attribution query + backfill |
| `/analytics/score-contribution` | GET/POST | Score component correlation analysis |
| `/analytics/rule-overlap` | GET | Rule co-occurrence matrix |
| `/backtest/compare` | GET | FULL vs CORE_LITE comparison |
| `/plan/allocation-score` | GET | Capital allocation ranking |

### Pages

| Page | URL | Nav label |
|------|-----|-----------|
| Filter Scorecard | `/filter-scorecard` | Scorecard |
| Score Validation | `/score-validation` | Score Lab |
| Execution Audit | `/execution-audit` | Exec Audit |

### Jobs

| File | How to run |
|------|-----------|
| `src/cron/research-refresh.ts` | `npx tsx src/cron/research-refresh.ts --run-now` |
| `research-refresh-task.bat` | Double-click or Task Scheduler |

---

## Data Model Summary

### CandidateOutcome (main research table)

One row per ticker per scan run. 50+ fields across 12 groups:

| Group | Fields | Populated by |
|-------|--------|-------------|
| Identity | scanId, ticker, name, sleeve, sector, cluster | Scan pipeline |
| Pipeline | status, stageReached, passed*, blocked* | Scan pipeline |
| Technicals | price, ma200, adx, DI, atr*, efficiency, volumeRatio, RS, hurst | Scan pipeline |
| Scores | bqs, fws, ncs, rankScore, dualScoreAction | Score backfill |
| Entry/Stop | entryTrigger, stopPrice, distancePct, entryMode | Scan pipeline |
| Sizing | suggestedShares/Risk/Cost | Scan pipeline |
| Anti-chase | antiChaseReason, earningsAction, daysToEarnings | Scan pipeline |
| Risk gates | riskGatesFailed | Scan pipeline |
| Data quality | dataFreshness | getDataFreshness() at scan time |
| Trade link | tradePlaced, tradeLogId, actualFill | backfillTradeLinks() |
| Forward outcomes | fwdReturn5d/10d/20d, mfeR, maeR, reached1R/2R/3R, stopHit | enrichCandidateOutcomes() |

**Unique constraint**: `(scanId, ticker)` — idempotent upsert.

### Supporting Models

| Model | Purpose | Populated by |
|-------|---------|-------------|
| FilterAttribution | Per-candidate filter pass/fail | Scan pipeline |
| ScoreBreakdown | Full BQS/FWS/NCS component decomposition | Nightly snapshot sync |
| EvRecord | Historical trade outcomes by regime/ATR/sleeve | Trade close |
| CorrelationFlag | High-correlation position pairs | Nightly correlation matrix |

---

## Known Risks

| Risk | Mitigation |
|------|------------|
| BQS/FWS/NCS are null in CandidateOutcome until score backfill runs | Research refresh job runs backfill; Score Lab page has "Backfill Scores" button |
| Forward enrichment requires Yahoo API calls (rate-limited) | Batch limited to 200 rows per run; grouped by ticker to minimize calls |
| Small sample sizes make analytics noisy | All tables show "Enriched" count; minimum 30 rows per bucket recommended |
| FWS vol-shock reduction (20→10) may affect edge cases | Change is based on overlap analysis; easily reversible (one constant) |
| ALLOC-EARNINGS removal means allocation ignores earnings proximity | NCS quality component still reflects earnings penalty; scan still blocks ≤2d |

---

## Open Questions

1. **Should BQS/FWS/NCS be computed inline during scan?** Currently left null and backfilled from ScoreBreakdown. Inline computation would require constructing a SnapshotRow from TechnicalData — non-trivial mapping.

2. **Should the research refresh hook into the nightly pipeline?** Currently a separate job. Adding a step to nightly.ts would ensure data is always fresh but adds ~4s to nightly runtime.

3. **What minimum sample size validates a filter/score band?** The scorecard shows results with any N, but statistical significance requires ~30+ enriched rows per bucket.

4. **Should CORE_LITE mode also skip risk gates 3–6 (concentration limits)?** Currently it keeps all 6 gates. A purer benchmark might skip concentration limits since they're portfolio-context-dependent.

5. **Is the 0.8-ATR anti-chase threshold optimal?** The execution audit can test this once fill data exists — compare fills that would have been blocked vs those that passed.

---

## How to Run the Research Flow

### 1. Generate data (scan)

```bash
# Via dashboard: click "Run Scan" on /scan page
# Or via API: POST /api/scan with userId, riskProfile, equity
```

### 2. Backfill scores + enrich outcomes

```bash
npx tsx src/cron/research-refresh.ts --run-now
# Or double-click: research-refresh-task.bat
```

### 3. View analytics

| Report | URL | What it shows |
|--------|-----|---------------|
| Filter Scorecard | `/filter-scorecard` | Passed vs blocked outcomes per rule |
| Score Validation | `/score-validation` | NCS/FWS/BQS band outcomes + Auto-action comparison |
| Execution Audit | `/execution-audit` | Model vs actual fill analysis |
| Allocation Ranking | `/api/plan/allocation-score` | Capital prioritization breakdown |

### 4. Compare FULL vs CORE_LITE

```bash
# Backtest comparison API:
curl http://localhost:3000/api/backtest/compare
# With filters:
curl http://localhost:3000/api/backtest/compare?sleeve=CORE&regime=BULLISH
```

### 5. Check rule overlap

```bash
curl http://localhost:3000/api/analytics/rule-overlap?minSamples=30
```
