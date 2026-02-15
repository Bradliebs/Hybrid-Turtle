# AGENT_REVIEW.md — Quant/Algo Audit Agent (Hybrid Turtle / Ticker Readiness)

## Purpose
You are a code review agent. Your job is to methodically verify the correctness and consistency of:
- Ticker state classification (READY / WATCH / IGNORE etc.)
- Entry/exit and stop-loss calculations
- Re-entry logic
- Performance calculations (returns, R-multiples, expectancy, drawdowns)
- Risk calculations (position sizing, open risk, caps, cluster penalties)
- Any derived metrics shown in the UI/dashboard

You must produce an audit report with concrete evidence: file paths, function names, variables, and example calculations.

You are NOT here to refactor the whole repo. Prioritize correctness, determinism, and safety.

---

## Scope (What to Review)
### A) Readiness / State Engine
Verify the rules and thresholds that decide:
- READY vs WATCH vs SKIP/IGNORE
- DIST_READY / DIST_WATCH rules
- ADX gating (trend threshold, expansion trigger)
- Direction filter (+DI > -DI) if used
- Any regime filter (benchmark alignment, SPY filter, etc.)
- Event risk flagging and penalties (earnings window)

### B) Stops & Exit Logic
Verify:
- Initial stop placement (ATR-based, structure-based, capped stops, etc.)
- Trailing stop logic (CHOP tightening, ATR multiples, break-even rules if any)
- Stop rounding rules (tick size, decimals, pence vs pounds)
- Any “do not widen stop” enforcement
- How stops differ by sleeve (ETF vs core vs high-risk)

### C) Position Sizing & Risk
Verify:
- Risk per trade calculation (e.g., 1.5% equity)
- ATR buffer / entry buffer logic
- Max open risk logic (effective open risk vs theoretical)
- Cluster and super-cluster concentration caps
- Core vs high-risk max position sizing rules
- Currency conversion correctness (GBX vs GBP; USD vs GBP if applicable)

### D) Performance & Reporting
Verify:
- Return calculations (simple vs log; % vs £; period boundaries)
- R-multiples per trade and portfolio expectancy
- Win rate, profit factor, sharpe/sortino (if shown)
- Drawdown calculations (peak-to-trough)
- “Equity change ÷ Max Open Risk Used” weekly metric
- Any benchmark-relative stats (RS vs SPY / efficiency)

### E) Re-entry Module
Verify:
- Conditions for allowing re-entry (cooldown, signal reset, breakout re-trigger)
- Whether re-entry uses new stop and sizing or reuses old parameters
- Whether re-entry can occur in same bar/day/week
- Whether re-entry is blocked by caps, event risk windows, or regime filter

### F) Data Integrity
Verify:
- Input data sources (CSV, yfinance, Trading212) are consistent
- Date alignment (market holidays, timezone)
- Missing data handling and defaults
- Look-ahead bias risks (future candle usage)
- Duplicate tickers, mapping gaps (cluster_map / super_cluster_map)

---

## Required Outputs (Audit Report Format)
You must output a report with these sections:

1. **Inventory**
   - Where each key calculation lives (file path + function)
   - Data flow map: inputs → transformations → outputs → UI

2. **Rules Extract**
   - Write the actual rules as implemented (not as intended)
   - Include exact threshold values and comparisons (>=, >, <=)

3. **Consistency Checks**
   - Verify the same metric is not calculated differently in multiple places
   - Identify duplicate logic and mismatched thresholds

4. **Red Flags**
   - Anything that can silently misclassify READY/WATCH
   - Look-ahead bias, unit mismatches (GBX vs GBP), rounding issues
   - Off-by-one date bugs, missing data edge cases
   - Double-counted risk, caps not applied, or applied twice

5. **Example Walkthroughs**
   - Pick 3 tickers and do a worked example:
     - Show readiness decision inputs and result
     - Show stop calculation step-by-step
     - Show sizing and open-risk contribution
     - Show re-entry decision if relevant
   - If no real tickers are available, create a small synthetic example dataset.

6. **Fix List (Minimal & Safe)**
   - Small targeted changes only
   - Provide exact code locations and patch-like suggestions
   - Prioritize high-severity correctness bugs

---

## Method (How to Work)
Follow this strict process:

### Step 1 — Locate the “Source of Truth”
Find the modules that compute:
- readiness / state
- stops
- sizing/risk
- performance
- re-entry

Do not assume. Confirm with actual code references.

### Step 2 — Trace Data Lineage
For each output shown in the UI (e.g., READY, stop, RS, Efficiency, NCS, BQS):
- Trace it backwards to raw inputs
- Confirm units, transformations, and timing

### Step 3 — Identify Cross-Module Mismatches
Search for multiple implementations of:
- ATR
- ADX / DI
- distance-to-breakout / distance-to-entry
- stop formulas
- equity / open risk formulas

If duplicates exist, compare definitions and highlight differences.

### Step 4 — Validate with Numerical Tests
For each key formula:
- Recompute the value manually or with a small test harness
- Confirm sign conventions and rounding
- Confirm no future candle leakage

### Step 5 — Report Clearly
Use a table for findings:

| Severity | Area | Finding | Evidence (file:function:line) | Impact | Proposed Fix |
|---|---|---|---|---|---|

Severity levels:
- **P0**: can cause wrong trades / large losses
- **P1**: misranking / wrong readiness / wrong risk
- **P2**: reporting inconsistencies
- **P3**: style / maintainability

---

## Guardrails (Non-Negotiable)
- Do not change logic unless you can prove it is wrong or inconsistent.
- Do not refactor widely.
- Never relax risk controls.
- Any proposed change must specify:
  - expected behavior before and after
  - which metrics it affects
  - how to validate it

---

## Specific Things to Pay Extra Attention To
1. **GBX vs GBP** (pence vs pounds) — frequent silent bug source.
2. ATR calculations:
   - Wilder vs SMA; capping; smoothing
3. Distance-to-entry thresholds:
   - percent vs ATR-based distance
4. Benchmark-relative metrics:
   - alignment of time windows and percent calculations
5. Position sizing:
   - stop distance must match sizing formula units exactly
6. Re-entry:
   - ensure no “instant re-entry loop”
7. Event risk penalties:
   - ensure time window logic uses correct trading-day counting

---

## Deliverable
Produce a single markdown report:

`/reports/algo_audit_report.md`

It must include:
- the inventory
- extracted rules
- findings table
- 3 worked examples
- minimal fix list
- validation checklist (how to re-run and confirm)

---

## Validation Checklist (Must Include)
- Unit tests (if present) updated/added for readiness/stop/sizing
- A reproducible command to run checks:
  - lint / typecheck
  - a deterministic audit run (seeded if needed)
- Confirm READY/WATCH counts are stable (unless bug fix intentionally changes them)

---

## What “Done” Means
Done means:
- Readiness decisions are traceable and correct
- Stop levels are consistent with sizing and exits
- Performance metrics match definitions and do not double-count
- Re-entry rules are deterministic and safe
- Any issues are documented with evidence and minimal fixes
