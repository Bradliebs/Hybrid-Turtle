# HybridTurtle — Causal Invariance Audit Page
## Formal Spec + Claude Code Audit & Build Prompt

---

## Section 1: What This Page Does (Formal Spec)

### Purpose

The `/causal-audit` page implements **Invariant Risk Minimisation (IRM)** analysis
across HybridTurtle's 7 signal layers. Where the `/signal-audit` page asks
"how much unique information does each signal contribute?", the causal audit asks
a harder question: **"does each signal work because it captures something real,
or because it happened to correlate with outcomes during training?"**

A signal that is merely correlated will break when the market regime changes.
A causally invariant signal will hold its predictive power across all regimes
because it is tapping into a structural relationship — not a coincidence.

This is the analytical foundation for trusting the Dynamic Signal Weighting
meta-model (Phase 3). If a signal fails the invariance test, it should be
down-weighted in all regimes, not just the one where it failed.

---

### Core Concept: IRM in Plain Terms

Standard analysis asks: does ADX predict good outcomes on average?

IRM asks: does ADX predict good outcomes **equally well across all regimes**
(trending, ranging, volatile, transitioning)?

If ADX predicts well in trending regimes but randomly in ranging regimes,
it is **regime-dependent** — its predictive power is a property of the
environment, not the signal itself.

If Hurst exponent predicts consistently across all regimes, it is
**causally invariant** — its relationship to outcomes is structural.

The output is an **invariance score per signal** (0–100):
- High invariance (> 70): signal is causally grounded — trust it across regimes
- Medium invariance (40–70): signal is partially regime-dependent — use with caution
- Low invariance (< 40): signal is spurious in at least one regime — flag for review

---

### The 7 Signals Being Audited

| Signal | Description | Expected Behaviour |
|--------|-------------|-------------------|
| ADX | Trend strength | High in trending, low in ranging — expect medium invariance |
| DI | Directional indicator | Regime-sensitive by design — expect lower invariance |
| Hurst | Trending vs mean-reverting | Should be invariant — measures persistence structurally |
| BIS | Breakout integrity | Quality signal — expect high invariance |
| DRS | Dual regime score | Meta-signal — regime-dependent by construction |
| Weekly ADX | Longer-timeframe trend | Slower, should be more invariant than daily ADX |
| BPS | Breakout probability | Multi-factor — expect medium-high invariance |

---

### Page Layout (Full Spec)

```
/causal-audit
│
├── Header
│     Title: "Causal Invariance Audit"
│     Subtitle: "IRM analysis — which signals are causally stable vs regime-dependent"
│     Last run: [timestamp] or "Never run"
│     Button: "Run Analysis" (manual trigger — not automatic)
│     Button: "Export CSV"
│
├── Summary Banner (shown after analysis completes)
│     Three stat cards:
│       • Causally invariant signals: N (invariance > 70)
│       • Partially dependent: N (40–70)
│       • Spurious / regime-dependent: N (< 40)
│     Interpretation line:
│       "N of 7 signals show causal stability across all regimes"
│
├── Invariance Score Bar Chart
│     Horizontal bar chart, one bar per signal (7 bars)
│     X-axis: 0–100 (invariance score)
│     Colour zones on bars:
│       0–39: red (spurious)
│       40–69: amber (partially dependent)
│       70–100: green (causally invariant)
│     Each bar labelled with signal name + score
│     Reference lines at 40 and 70 (threshold markers)
│
├── Beta-Per-Regime Chart
│     For each signal: a grouped bar or small-multiple chart showing
│     the signal's predictive coefficient (beta) in each regime:
│       TRENDING | RANGING | VOLATILE | TRANSITIONING
│     If beta is consistent across regimes → causally invariant
│     If beta varies widely → regime-dependent
│     Tooltip on each bar: "Beta in [regime]: [value] (N=[sample_count])"
│     Low sample count warning: if N < 20 for any regime, show: "⚠ Low sample (N=[n])"
│
├── Invariance Variance Chart
│     Line chart showing invariance score per signal over time
│     (if multiple audit runs exist — otherwise disabled with message
│     "Run analysis multiple times to see trend")
│     X-axis: audit run date
│     Y-axis: invariance score 0–100
│     One line per signal, colour-coded
│
├── Recommendation Table
│     One row per signal (7 rows), sorted by invariance score ascending
│     (most problematic first)
│
│     Columns:
│       Signal | Invariance Score | Regime Variance | Worst Regime | 
│       Recommendation | Action
│
│     Recommendation values:
│       CAUSAL    — invariance > 70: "Stable across regimes. Trust this signal."
│       MONITOR   — invariance 40–70: "Regime-dependent. Weight carefully."
│       SPURIOUS  — invariance < 40: "Unreliable. Consider removing or isolating."
│
│     Action column:
│       CAUSAL    → green pill "Keep"
│       MONITOR   → amber pill "Watch"
│       SPURIOUS  → red pill "Review"
│
├── Regime Breakdown Accordion
│     Expandable section per regime (TRENDING / RANGING / VOLATILE / TRANSITIONING)
│     Each accordion shows:
│       - How many scan results fell in this regime (N trades/scans)
│       - Signal performance table in this regime: signal | beta | R² | p-value
│       - Signals that performed significantly worse than average: highlighted red
│       - Signals that performed significantly better: highlighted green
│
└── Footer
      "Analysis based on [N] scan results across [N] regime periods"
      "Powered by Invariant Risk Minimisation (IRM)"
      "Results stored in InvarianceAuditResult table"
```

---

### API Route Spec

**Route:** `GET /api/prediction/causal-audit`
**Purpose:** Returns latest InvarianceAuditResult records for display

**Route:** `POST /api/prediction/causal-audit/run`
**Purpose:** Triggers a fresh IRM analysis run

**Response shape (GET):**
```typescript
{
  lastRunAt: string | null,
  sampleSize: number,
  regimeCounts: Record<string, number>,
  signals: Array<{
    name: string,
    invarianceScore: number,       // 0–100
    recommendation: 'CAUSAL' | 'MONITOR' | 'SPURIOUS',
    betaByRegime: Record<string, number>,
    varianceAcrossRegimes: number, // std dev of betas
    worstRegime: string,
    sampleCountByRegime: Record<string, number>,
  }>,
  historicalRuns: Array<{
    runAt: string,
    signalScores: Record<string, number>,
  }>
}
```

---

### IRM Computation Logic (for API implementation)

```
For each signal S in [ADX, DI, Hurst, BIS, DRS, WeeklyADX, BPS]:

  Step 1 — Partition scan results by regime:
    Pull ScanResult records joined with RegimeHistory
    Group by regime: TRENDING | RANGING | VOLATILE | TRANSITIONING
    Minimum 20 records per regime for a valid estimate

  Step 2 — Compute beta per regime (OLS regression):
    For each regime R:
      Regress: outcome ~ signal_S_score
      outcome = 1 if trade R-multiple > 0.5, else 0 (binary)
      beta_R = regression coefficient of signal_S in regime R
      Record: beta_R, R²_R, p_value_R, N_R

  Step 3 — Compute invariance score:
    variance = std_dev([beta_TRENDING, beta_RANGING, beta_VOLATILE, beta_TRANSITIONING])
    mean_beta = mean of all regime betas
    
    If mean_beta <= 0:
      invarianceScore = 0  (signal is net-negative — remove)
    Else:
      // Coefficient of variation — lower variance relative to mean = more invariant
      CV = variance / abs(mean_beta)
      invarianceScore = clamp(100 - (CV * 100), 0, 100)

  Step 4 — Classification:
    invarianceScore > 70  → CAUSAL
    invarianceScore 40–70 → MONITOR
    invarianceScore < 40  → SPURIOUS

  Step 5 — Store result in InvarianceAuditResult:
    One record per signal per run
    Include: signalName, invarianceScore, recommendation,
             betaByRegime (JSON), varianceAcrossRegimes,
             worstRegime, sampleCountByRegime (JSON), runAt
```

---

### Connection to Phase 3 (Dynamic Signal Weighting)

The causal audit feeds directly into the meta-model:

```
InvarianceAuditResult
    ↓
signal-weight-meta-model.ts (reads invariance scores)
    ↓
Applies invariance penalty to dynamic weights:
  weight_adjusted = weight_dynamic × (invarianceScore / 100)
  
A signal with invarianceScore=30 gets its dynamic weight multiplied by 0.30
A signal with invarianceScore=95 gets its dynamic weight multiplied by 0.95
```

This means a causally unreliable signal can never dominate the NCS
regardless of what the regime-based meta-model assigns it —
the invariance score acts as a structural ceiling on influence.

This connection should be documented on the page with a note:
"Invariance scores feed into the Dynamic Signal Weighting meta-model.
Low-invariance signals are automatically down-weighted system-wide."

---

### Sidebar Navigation

- Section: **System** (alongside Signal Audit)
- Label: **Causal Audit**
- Route: `/causal-audit`
- Icon: suggest using an existing icon from the codebase that implies
  causality or filtering (e.g. a funnel, branches, or shield icon)

---

## Section 2: Claude Code Audit & Build Prompt

Paste everything below this line into Claude Code.

---

```
BEFORE WRITING ANY CODE:
1. Read CLAUDE.md in full
2. Read every file in "Files to Read First" below
3. Complete the AUDIT in Step 1 before writing any code

SACRED FILES — NEVER MODIFY:
stop-manager.ts · position-sizer.ts · risk-gates.ts ·
regime-detector.ts · dual-score.ts · scan-engine.ts

---

FILES TO READ FIRST:
  CLAUDE.md
  prisma/schema.prisma                          (InvarianceAuditResult table)
  src/app/causal-audit/page.tsx                 (current state)
  src/app/api/prediction/causal-audit/          (existing routes if any)
  src/lib/prediction/ (directory listing)       (existing prediction modules)
  src/app/signal-audit/page.tsx                 (use as structural pattern)
  src/app/api/prediction/signal-audit/          (use as API pattern)
  src/types/index.ts                            (nav structure — sidebar links)
  src/components/shared/ (directory listing)    (existing shared components)

---

STEP 1 — AUDIT (no code written yet):

Check each item below. For each, output one of:
  [EXISTS_COMPLETE]  — exists and matches spec
  [EXISTS_PARTIAL]   — exists but missing behaviour (list gaps)
  [MISSING]          — does not exist at all

ITEMS TO AUDIT:

PAGE:
  A. src/app/causal-audit/page.tsx
     Check for:
     - Header with title, subtitle, last-run timestamp, "Run Analysis" button, "Export CSV" button
     - Summary banner: 3 stat cards (causally invariant / partially dependent / spurious counts)
     - Invariance Score Bar Chart (horizontal, colour-zoned at 40 and 70, 7 signals)
     - Beta-Per-Regime Chart (grouped bars per signal per regime, tooltips, low-N warning)
     - Invariance Variance Chart (multi-line, historical runs, disabled state if < 2 runs)
     - Recommendation Table (7 rows, sorted by score ascending, all columns present)
     - Regime Breakdown Accordion (4 regimes, expandable, per-regime signal table)
     - Footer with sample size, regime count, IRM attribution
     - Note linking to Phase 3 meta-model integration

API ROUTES:
  B. GET  /api/prediction/causal-audit
     Check for: returns InvarianceAuditResult records in correct response shape
  C. POST /api/prediction/causal-audit/run
     Check for: triggers IRM computation, stores results in InvarianceAuditResult

COMPUTATION:
  D. IRM computation logic
     Check for: partition by regime, OLS beta per regime, CV-based invariance score,
     classification into CAUSAL/MONITOR/SPURIOUS, result storage

META-MODEL CONNECTION:
  E. signal-weight-meta-model.ts
     Check for: invariance score penalty applied to dynamic weights
     (weight_adjusted = weight_dynamic × invarianceScore/100)

NAVIGATION:
  F. Sidebar link for /causal-audit
     Check for: exists, correct section (System), correct label (Causal Audit),
     correct route (/causal-audit)

Print full audit report before proceeding.

---

STEP 2 — BUILD (only items marked EXISTS_PARTIAL or MISSING):

Work through gaps in the order A → F.
For each gap, build or complete the missing piece.

SPECIFIC INSTRUCTIONS PER ITEM:

Item A — Page (causal-audit/page.tsx):
  - Read signal-audit/page.tsx first for structural pattern
  - Match layout style, loading states, empty states, and error handling patterns
  - Charts: use recharts (already in project) — match chart style from signal-audit
  - Horizontal bar chart: use BarChart from recharts with layout="vertical"
  - Beta-per-regime: use grouped BarChart with 4 bars per signal
  - Historical variance: use LineChart — disable gracefully if < 2 runs exist
  - Recommendation table: use existing table patterns from the codebase
  - Regime accordion: use existing expandable/collapsible pattern from codebase
  - Colour zone reference lines at 40 and 70: use ReferenceLine from recharts
  - Export CSV: same pattern as signal-audit CSV export
  - Meta-model note: simple info box at bottom of recommendation table

Item B — GET /api/prediction/causal-audit:
  - Read signal-audit API route for pattern
  - Query InvarianceAuditResult table (read prisma schema for exact field names)
  - Group historical runs by runAt timestamp
  - Return response shape defined in spec above
  - Follow existing auth middleware pattern

Item C — POST /api/prediction/causal-audit/run:
  - Pulls ScanResult records joined with their scan's regime data
  - Requires minimum 20 records per regime — if not met, proceed with available
    data and flag low-sample regimes in response
  - Implements IRM computation as specified in Section 1
  - Stores one InvarianceAuditResult row per signal per run
  - Returns: { success: true, signalsAnalysed: N, runsAt: timestamp }
  - Long-running: wrap in try/catch, return partial results if any signal fails
  - Do not block — if computation takes > 5s, log a warning

Item D — IRM computation:
  - If computation logic is missing or incorrect, implement as specified in Section 1
  - Key formula: CV = std_dev(betas) / abs(mean_beta)
                 invarianceScore = clamp(100 - CV * 100, 0, 100)
  - If mean_beta <= 0: invarianceScore = 0
  - OLS regression: implement as simple linear regression (no external library needed)
    slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    This is sufficient for beta estimation with these sample sizes

Item E — Meta-model connection (signal-weight-meta-model.ts):
  - Read the file carefully before touching it
  - If invariance penalty is missing: add it as the final step in weight computation
  - weight_adjusted = weight_dynamic × (invarianceScore / 100)
  - Pull latest invarianceScore per signal from InvarianceAuditResult
  - If no audit has been run yet: default invarianceScore = 75 for all signals
    (cautiously optimistic — do not default to 100 which would disable the penalty)
  - Log when invariance penalty is applied: console.log with signal and penalty factor

Item F — Sidebar navigation:
  - Read types/index.ts nav structure
  - Add /causal-audit under "System" section (alongside Signal Audit)
  - Label: "Causal Audit"
  - Do not restructure existing nav items

---

AFTER ALL ITEMS COMPLETE:

Print final summary:
CAUSAL AUDIT BUILD COMPLETE
Existing and complete: [N]
Fixed (partial → complete): [N]  
Built from scratch: [N]
Total gaps filled: [N]

Sacred files modified: NONE
TypeScript errors: 0
```
