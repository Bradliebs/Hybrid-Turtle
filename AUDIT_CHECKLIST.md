# AUDIT_CHECKLIST.md — Algorithm & Metrics Verification (Tick-Box)

Use this checklist to methodically verify the trading algorithm outputs shown in the UI:
READY/WATCH state, stops, sizing, performance, re-entry, and risk overlays.

Mark each item ✅ / ❌ and add a one-line note + evidence pointer (file:function:line).

---

## 0) Setup & Baseline
- [ ] ✅ Repo builds successfully (install/start works)
- [ ] ✅ `npm run lint` passes
- [ ] ✅ `npm run typecheck` passes
- [ ] ✅ Prisma schema validates (`prisma validate`)
- [ ] ✅ App runs and shows ticker table/dashboard
- [ ] ✅ Identify where the UI pulls its data (route/loader/query)

**Evidence:**
- Build commands used:
- Primary UI page(s):
- Primary API route(s) or server actions:
- Primary data source(s):

---

## 1) Data & Units Sanity (Highest Bug Probability)
- [ ] ✅ Confirm price units per market (GBX vs GBP, USD vs GBP)
- [ ] ✅ Confirm all % values are true percent (0–100) vs fraction (0–1)
- [ ] ✅ Confirm ATR units match price units
- [ ] ✅ Confirm volume units and any normalization
- [ ] ✅ Confirm dates/timezones (Europe/London, trading days vs calendar days)
- [ ] ✅ Confirm no duplicate tickers / missing identifiers
- [ ] ✅ Confirm cluster_map and super_cluster_map coverage (no silent "Uncategorized")

**Evidence:**
- Unit handling code:
- GBX/GBP conversion code (if any):
- Date alignment code:

---

## 2) Readiness Engine (READY / WATCH / SKIP)
### 2.1 Rules Extraction
- [ ] ✅ Extract the exact implemented rules for state classification
- [ ] ✅ List all thresholds (>=, >, <=) and constants
- [ ] ✅ Confirm DIST_READY and DIST_WATCH meaning + formula
- [ ] ✅ Confirm “breakout” definition (Donchian, MA, high/low, etc.)
- [ ] ✅ Confirm ADX threshold rules (trend and expansion trigger)
- [ ] ✅ Confirm DI direction filter (+DI > -DI) is applied correctly
- [ ] ✅ Confirm regime filter / benchmark alignment logic (if used)
- [ ] ✅ Confirm event/earnings risk window and penalties (if used)

### 2.2 Consistency
- [ ] ✅ Ensure READY logic is not duplicated with mismatched thresholds elsewhere
- [ ] ✅ Ensure UI labels match computed states (no swapped mapping)

**Evidence:**
- State function location(s):
- Threshold constants location(s):

---

## 3) Stops & Exits (Initial + Trailing)
### 3.1 Initial Stop
- [ ] ✅ Confirm initial stop formula (ATR multiple, structure, capped, buffer)
- [ ] ✅ Confirm stop distance is never negative/zero
- [ ] ✅ Confirm rounding rules and tick-size/decimal handling
- [ ] ✅ Confirm stop uses correct candle (no future leakage)

### 3.2 Trailing Stop / Tightening
- [ ] ✅ Confirm CHOP tightening rule and ATR multiple (e.g., 1.5xATR)
- [ ] ✅ Confirm stops only move in the protective direction (never widen)
- [ ] ✅ Confirm trailing stop frequency (daily/weekly) matches system intent
- [ ] ✅ Confirm per-sleeve differences (core vs high-risk vs ETF)

**Evidence:**
- Stop calc function(s):
- Trailing/tightening function(s):

---

## 4) Position Sizing & Risk Accounting
- [ ] ✅ Confirm risk_per_trade_pct uses current equity consistently
- [ ] ✅ Confirm position sizing uses stop distance in correct units
- [ ] ✅ Confirm ATR buffer / entry buffer affects sizing consistently
- [ ] ✅ Confirm max open risk (effective) is computed correctly
- [ ] ✅ Confirm caps:
  - [ ] max position core
  - [ ] max position high-risk
  - [ ] max sleeve core/ETF/high-risk
  - [ ] max cluster
  - [ ] max super-cluster
- [ ] ✅ Confirm cluster/super-cluster penalty is applied once (not twice)
- [ ] ✅ Confirm “risk per trade” vs “open risk” are not double-counted

**Evidence:**
- Sizing function:
- Open risk function:
- Cap enforcement function:

---

## 5) Re-entry Logic
- [ ] ✅ Identify re-entry enable flag and where enforced
- [ ] ✅ Confirm re-entry requires signal reset (not immediate loop)
- [ ] ✅ Confirm cooldown rules (bars/days) if present
- [ ] ✅ Confirm re-entry recalculates stop + sizing (not reusing stale)
- [ ] ✅ Confirm re-entry respects caps and event-risk windows
- [ ] ✅ Confirm re-entry cannot happen on same bar unless explicitly intended

**Evidence:**
- Re-entry module/function:
- Cooldown/signal reset logic:

---

## 6) Performance Metrics & Reporting
### 6.1 Trade-level
- [ ] ✅ Confirm return calculation per trade (gross/net if fees exist)
- [ ] ✅ Confirm R-multiple formula and sign conventions
- [ ] ✅ Confirm win rate and profit factor definitions

### 6.2 Portfolio-level
- [ ] ✅ Confirm equity curve construction (ordering, fill-forward)
- [ ] ✅ Confirm drawdown calc is peak-to-trough and correct
- [ ] ✅ Confirm Sharpe/Sortino (if shown): frequency assumptions correct
- [ ] ✅ Confirm benchmark comparison windows (RS vs benchmark)

### 6.3 Weekly “One Metric to Rule Them All”
- [ ] ✅ Confirm weekly equity change definition (start/end timestamps)
- [ ] ✅ Confirm max open risk used definition and aggregation window
- [ ] ✅ Confirm metric computed as: Equity change ÷ Max Open Risk Used

**Evidence:**
- Performance module/functions:
- Any reporting aggregation code:

---

## 7) Look-ahead Bias & Off-by-One Checks
- [ ] ✅ Confirm indicators only use past and current bars
- [ ] ✅ Confirm “breakout” compares against prior N bars (excluding current bar unless intended)
- [ ] ✅ Confirm weekly signals use completed weekly candles (not partial week)
- [ ] ✅ Confirm earnings/event windows use trading days (if intended)

**Evidence:**
- Indicator code:
- Candle indexing logic:

---

## 8) UI / API Consistency
- [ ] ✅ Confirm UI displays same values returned by API/server (no recomputation mismatch)
- [ ] ✅ Confirm formatting doesn’t change meaning (e.g., rounding hides errors)
- [ ] ✅ Confirm sorting/ranking uses correct numeric fields (not strings)
- [ ] ✅ Confirm missing values handled (null/NaN) without silent coercion

**Evidence:**
- UI component(s):
- API route(s):
- Formatting utilities:

---

## 9) Cross-Check With Worked Examples (Must Do)
Pick 3 tickers (1 READY, 1 WATCH, 1 borderline).
For each:
- [ ] ✅ Show inputs used for readiness decision
- [ ] ✅ Recompute DIST_READY/DIST_WATCH manually
- [ ] ✅ Recompute stop manually
- [ ] ✅ Recompute sizing and risk contribution manually
- [ ] ✅ Validate re-entry decision if applicable
- [ ] ✅ Confirm displayed UI matches computed numbers

**Evidence:**
- Example tickers:
- Manual calc notes:
- Screenshot/console output references (if available):

---

## 10) Findings Log (Use This Table)
Record every issue found:

| Severity (P0–P3) | Area | Finding | Evidence (file:function:line) | Impact | Proposed Fix | Validation |
|---|---|---|---|---|---|---|

Severity definitions:
- **P0**: could trigger wrong trades / large losses
- **P1**: misclassifies readiness / mis-sizes / wrong stops
- **P2**: reporting inconsistencies / minor ranking issues
- **P3**: maintainability / style

---

## 11) Final Output Requirements
At completion, produce:
- `/reports/algo_audit_report.md` containing:
  - Inventory
  - Rules Extract
  - Findings table
  - 3 worked examples
  - Minimal fix list + validation steps
- A command list to reproduce checks locally.

---

## 12) Done Criteria
You are done only when:
- State classification is traceable and correct
- Stops are consistent with sizing and exits
- Risk caps and overlays apply correctly and only once
- Performance metrics match definitions
- Re-entry is deterministic and safe
- Findings are documented with evidence and minimal fixes
