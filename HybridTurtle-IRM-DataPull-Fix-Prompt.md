# HybridTurtle — Fix IRM Data-Pull
## Use TradeLog + T212 Imported History for Causal Audit Outcomes

Paste this entire prompt into Claude Code.

---

```
TASK: Rewrite the IRM computation data-pull in the causal audit route to use
real trade outcomes from TradeLog (including T212 imported history) instead of
the current approach that finds no data and falls back to 50% defaults.

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md in full
2. Read every file listed under "Files to Read First" below
3. Do not write a single line until all reading is complete

SACRED FILES — NEVER MODIFY:
stop-manager.ts · position-sizer.ts · risk-gates.ts ·
regime-detector.ts · dual-score.ts · scan-engine.ts

---

FILES TO READ FIRST:
  CLAUDE.md
  prisma/schema.prisma
    — read TradeLog model fully (all fields, especially:
       ticker, entryDate, exitDate, rMultiple, entryPrice,
       regime, t212ImportedAt, accountType)
    — read ScanResult model fully (all fields, especially:
       ticker, createdAt, scan relation, signal component fields)
    — read RegimeHistory model fully (all fields)
    — read Scan model (relation to ScanResult, date field)
  src/app/api/prediction/causal-audit/run/route.ts   (current implementation)
  src/app/api/prediction/invariance/route.ts         (GET route — understand response shape)
  src/lib/prediction/tda/                            (read — understand how regime data is used)
  src/app/api/prediction/signal-audit/run/route.ts   (read — understand how ScanResult fields
                                                       map to signal names for MI analysis)

---

UNDERSTAND BEFORE WRITING:

The current IRM computation fails because it queries for outcomes that don't
exist in the expected location. The fix joins three existing tables:

  TradeLog      → real outcomes (R-multiple, win/loss, entry/exit dates)
  ScanResult    → signal scores at time of entry (within ±3 days of entryDate)
  RegimeHistory → market regime at time of entry

All three tables already have data. The fix is purely in how they are joined.

---

STEP 1 — AUDIT THE CURRENT DATA-PULL:

Before writing any fix, read the current run route and answer:

  Q1: Which table does the current implementation query for outcomes?
  Q2: Does it reference TradeLog at all?
  Q3: How does it currently extract signal component scores from ScanResult?
      (What field names does it use? Are these the right fields?)
  Q4: Does it currently join RegimeHistory or use a regime field from ScanResult?
  Q5: How many rows does it currently find? (Add a console.log count and run
      mentally — based on the schema, will the current query ever return data?)

Print audit answers before proceeding to Step 2.

---

STEP 2 — READ THE TRADELOG SCHEMA:

Identify:
  - The field that stores the ticker symbol
  - The field that stores entry date (may be entryDate, createdAt, or openedAt)
  - The field that stores the R-multiple outcome (rMultiple or equivalent)
  - The field that stores whether it was a T212 import (t212ImportedAt or source field)
  - The field that stores regime at time of trade (if present — may not exist)
  - Whether exitDate / closedAt is present to confirm trade is completed

Print the exact field names you found before proceeding.

---

STEP 3 — READ THE SCANRESULT SCHEMA:

Identify:
  - The field that stores the scan date / timestamp
  - The field that links to the parent Scan record
  - The exact field names for each of the 7+ signal component scores:
      ADX score field name
      DI score field name
      Hurst score field name
      BIS score field name
      DRS score field name
      Weekly ADX score field name
      BPS score field name
      Any additional signal fields (Volatility, Proximity, Rel. Strength, Vol Bonus)
  - The ticker field name

Print the exact field names you found before proceeding.

---

STEP 4 — WRITE THE FIXED DATA-PULL FUNCTION:

Create or replace a function: `buildIRMDataset()` in the run route.

The function must:

  A. Query all completed TradeLog entries:
     - exitDate (or equivalent) is not null
     - rMultiple is not null
     - rMultiple is a finite number (not NaN, not Infinity)
     - Include both system-executed trades AND T212 imported trades
     - Minimum viable dataset: if fewer than 10 completed trades exist,
       return early with:
       { error: 'INSUFFICIENT_DATA',
         message: 'Minimum 10 completed trades required for IRM analysis. Found: N',
         tradesFound: N }
       Do not fall back to defaults — return the error explicitly so the UI
       can show a meaningful message instead of fake 50% scores.

  B. For each completed trade, find the matching ScanResult:
     Query ScanResult where:
       ticker = trade.ticker
       AND scan.date (or scanResult.createdAt) is within ±3 days of trade.entryDate
     If multiple ScanResults match: use the one closest to entryDate
     If no ScanResult matches: skip this trade (log: "No scan found for [ticker]
       within ±3 days of [entryDate] — skipping")
     If > 30% of trades have no matching ScanResult: log a warning:
       "WARNING: [N]% of trades have no matching scan result.
        Consider running a backfill scan or widening the match window."

  C. For each matched trade+scan pair, find the regime:
     Priority order:
       1. If TradeLog has a regime field and it is populated: use it directly
       2. Else: query RegimeHistory for the regime on trade.entryDate
          (find the RegimeHistory record where date <= entryDate ORDER BY date DESC LIMIT 1)
       3. Else: use ScanResult's regime field if present
       4. Else: mark regime as 'UNKNOWN' and exclude from per-regime beta calculation
          (still include in overall invariance calculation)

  D. Build the regression dataset:
     Each row:
     {
       ticker: string,
       entryDate: Date,
       regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITIONING' | 'UNKNOWN',
       outcome: number,        // 1 if rMultiple > 0.5, else 0 (binary classification)
       outcomeR: number,       // raw rMultiple (for continuous regression variant)
       signals: {
         adx: number,
         di: number,
         hurst: number,
         bis: number,
         drs: number,
         weeklyAdx: number,
         bps: number,
         // include any additional signal fields found in Step 3
       }
     }

  E. Validate dataset before running regression:
     - Log total rows: "IRM dataset: [N] trades matched to scan results"
     - Log regime distribution: "Regime counts: TRENDING=[N], RANGING=[N], ..."
     - If any regime has < 5 rows: flag it as LOW_SAMPLE for that regime
       (still compute beta but mark result unreliable)
     - If any regime has 0 rows: skip beta computation for that regime,
       use mean beta from other regimes as placeholder

---

STEP 5 — UPDATE THE IRM COMPUTATION:

After buildIRMDataset() is fixed, verify the downstream IRM computation
(OLS beta per regime, CV-based invariance score) correctly handles:

  - The new dataset structure from Step 4
  - LOW_SAMPLE regimes (compute but flag)
  - UNKNOWN regime rows (exclude from per-regime but include in overall)
  - The case where only 1 or 2 regimes have data (partial invariance score)
  - Signal fields that are null or 0 in ScanResult (skip that row for that signal)

The invariance formula remains unchanged:
  CV = std_dev(betas) / abs(mean_beta)
  invarianceScore = clamp(100 - CV * 100, 0, 100)
  If mean_beta <= 0: invarianceScore = 0

---

STEP 6 — UPDATE THE API RESPONSE:

The GET /api/prediction/invariance (or causal-audit) route response should now include:

  dataSource: 'TRADELOG' | 'INSUFFICIENT_DATA' | 'DEFAULT_FALLBACK'
  tradesUsed: number          // how many TradeLog records contributed
  scanMatchRate: number       // % of trades that found a matching ScanResult
  regimeCounts: Record<string, number>  // how many trades per regime
  lowSampleRegimes: string[]  // regimes with < 5 samples

Add these fields to the existing response without removing anything.

The UI causal-audit page should show:
  "Analysis based on [N] real trades ([N] matched to scan results)"
  instead of the current generic footer.

If dataSource === 'INSUFFICIENT_DATA': show a banner on the causal-audit page:
  "⚠ Insufficient trade history for IRM analysis.
   Minimum 10 completed trades required. Currently: [N].
   Results will appear automatically after more trades close."
  Do not show fake 50% scores in this state — show empty/disabled state.

---

STEP 7 — UPDATE THE SIGNAL AUDIT SIMILARLY:

Check whether /api/prediction/signal-audit/run has the same problem —
querying for outcome data that doesn't exist.

If signal-audit also falls back to defaults due to empty outcome data:
  Apply the same TradeLog data-pull fix to signal-audit.
  The MI computation doesn't need outcomes (MI is unsupervised) —
  but if signal-audit uses outcomes for any part of its analysis,
  fix that too.

If signal-audit does NOT use outcome data (pure MI on signal scores):
  Note this and skip Step 7.

---

AFTER ALL STEPS COMPLETE:

Verify TypeScript compiles with 0 errors.

Test the fix mentally:
  Given the T212 imported TradeLog records currently in the DB:
  - How many completed trades (exitDate not null, rMultiple not null) exist?
  - How many of those match a ScanResult within ±3 days?
  - What is the regime distribution of matched trades?
  Print these counts.

Print final summary:
IRM DATA-PULL FIXED
Trades found in TradeLog:        [N]
Trades matched to ScanResult:    [N] ([%] match rate)
Regime distribution:             TRENDING=[N] RANGING=[N] VOLATILE=[N] TRANSITION=[N]
Data source:                     [TRADELOG / INSUFFICIENT_DATA]
Signal audit affected:           [YES — fixed / NO — not affected]
Sacred files modified:           NONE
TypeScript errors:               0

If data source is INSUFFICIENT_DATA:
  State clearly how many more closed trades are needed before IRM
  will produce real scores, and which regimes need the most data.
```
