# HybridTurtle — Task 3 & 4
## End-to-End Validation Prompt + CLAUDE.md Update Prompt

---

# TASK 3: End-to-End Validation Prompt

Paste this into Claude Code as a standalone session.

---

```
TASK: Run a full end-to-end validation of the HybridTurtle prediction engine
by simulating a Tuesday execution flow. This is a READ-ONLY audit —
no trades are placed, no DB writes occur except where explicitly noted.
The goal is to catch integration bugs before real capital is at risk.

BEFORE STARTING:
1. Read CLAUDE.md in full
2. Read prisma/schema.prisma
3. Read src/types/index.ts

SACRED FILES — NEVER MODIFY:
stop-manager.ts · position-sizer.ts · risk-gates.ts ·
regime-detector.ts · dual-score.ts · scan-engine.ts

---

VALIDATION FLOW (simulate a Tuesday execution decision end-to-end):

PHASE 1 — DATA LAYER
  Test: Can the prediction engine access all data it needs?

  1a. ConformalCalibration table
      Query: SELECT * FROM ConformalCalibration ORDER BY calibratedAt DESC LIMIT 1
      Pass: record exists with qHat, qHatUp, qHatDown, sampleSize > 0
      Fail: no records, or sampleSize = 0
      If fail: note "Conformal calibration not yet run — intervals will use defaults"

  1b. GNNModelWeights table
      Query: most recent record
      Pass: record exists, trainedAt within last 7 days
      Fail: no record, or stale (> 7 days)
      If stale: note "GNN weights stale — propagation scores will show UNVALIDATED"

  1c. InvarianceAuditResult table
      Query: most recent run per signal (7 signals)
      Pass: all 7 signals have a record
      Fail: missing signals, or no records
      If fail: note "Invariance audit not run — meta-model using default 0.75 penalty"

  1d. ThreatLibraryEntry table
      Query: COUNT(*)
      Pass: count >= 3 (bootstrap entries loaded)
      Fail: count = 0
      If fail: note "Threat library empty — immune system running blind"

  1e. LeadLagEdge table
      Query: COUNT(*)
      Pass: count > 0
      Fail: count = 0

  Print Phase 1 summary:
  PHASE 1: DATA LAYER
  ConformalCalibration:    [PASS/FAIL] [detail]
  GNNModelWeights:         [PASS/FAIL] [detail]
  InvarianceAuditResult:   [PASS/FAIL] [detail]
  ThreatLibraryEntry:      [PASS/FAIL] [detail]
  LeadLagEdge:             [PASS/FAIL] [detail]

---

PHASE 2 — API ROUTE INTEGRATION
  Test: Do all prediction API routes respond without errors?
  Method: call each route handler directly (import and invoke, do not use fetch)
  Use a mock ticker symbol: "NVDA" for ticker-specific routes

  Routes to test:
  2a.  GET  /api/prediction/calibrate         → responds 200, returns calibration data
  2b.  GET  /api/prediction/interval          → responds 200, returns { lower, upper, point, width }
  2c.  GET  /api/prediction/signal-weights    → responds 200, returns weight vector (7 keys)
  2d.  POST /api/prediction/stress-test       → responds 200, returns { stopHitProbability, gate }
  2e.  GET  /api/prediction/gnn-score         → responds 200, returns { gnnScore, label }
  2f.  GET  /api/prediction/bayesian-update   → responds 200, returns { priorNCS, posteriorNCS }
  2g.  GET  /api/prediction/kelly-multiplier  → responds 200, returns { multiplier, adjustedSize }
  2h.  GET  /api/prediction/rl-action         → responds 200, returns { action, confidence }
  2i.  GET  /api/signals/vpin                 → responds 200, returns { vpinScore, signal }
  2j.  GET  /api/sentiment/score              → responds 200, returns { overallScore, signal }
  2k.  GET  /api/prediction/tda-regime        → responds 200, returns { regimeLabel, transitionWarning }
  2l.  GET  /api/prediction/danger-level      → responds 200, returns { dangerScore }
  2m.  GET  /api/prediction/lead-lag          → responds 200, returns upstream assets array
  2n.  GET  /api/prediction/trade-pulse       → responds 200, returns { tradePulseScore, grade }
  2o.  GET  /api/prediction/causal-audit      → responds 200, returns signal array
  2p.  GET  /api/execution/quality-report     → responds 200, returns slippage data

  For each route:
    - If route file does not exist: [MISSING] — note the gap
    - If route throws an error: [ERROR] — print the error message
    - If route returns unexpected shape: [SHAPE_MISMATCH] — note what was expected vs returned
    - If route responds correctly: [PASS]

  Print Phase 2 summary:
  PHASE 2: API ROUTES
  [route path]  [PASS/MISSING/ERROR/SHAPE_MISMATCH]  [detail if not PASS]

---

PHASE 3 — COMPONENT INTEGRATION
  Test: Are all prediction components correctly integrated into their parent pages?
  Method: static analysis — read parent component files and verify imports + usage

  3a. TodayPanel (src/app/plan/page.tsx or relevant component)
      Check: NCSIntervalBadge imported and used ✓/✗
      Check: FailureModePanel imported and used ✓/✗
      Check: StressTestGauge imported and used (Conditional + Auto-Yes only) ✓/✗
      Check: LeadLagPanel imported and used ✓/✗
      Check: GNNPropagationBadge imported and used ✓/✗
      Check: LiveNCSTracker imported and used ✓/✗
      Check: VPINBadge imported and used ✓/✗
      Check: SentimentFusionBadge imported and used (Conditional only) ✓/✗
      Check: TradePulseScore grade pill imported and used ✓/✗
      Check: "Full Analysis →" link present for Conditional/Auto-Yes cards ✓/✗

  3b. TodayPanel header / system status bar
      Check: SignalWeightPanel imported and used ✓/✗
      Check: TDARegimeBadge imported and used ✓/✗
      Check: DangerLevelIndicator in Navbar (src/components/shared/Navbar.tsx) ✓/✗

  3c. BuyConfirmationModal
      Check: KellySizingAdvisor imported and used ✓/✗
      Check: Kelly toggle reads from settings ✓/✗

  3d. Position cards (PositionsTable or equivalent)
      Check: RLTradeAdvisor imported and used ✓/✗
      Check: Shadow mode reads from settings ✓/✗

  3e. TradePulseDashboard (trade-pulse/[ticker]/page.tsx)
      Check: Kelly advisor row present ✓/✗
      Check: RL recommendation badge present ✓/✗
      Check: Stale data indicator present ✓/✗
      Check: Concerns panel (risks first) present ✓/✗
      Check: Opportunities panel present ✓/✗

  Print Phase 3 summary:
  PHASE 3: COMPONENT INTEGRATION
  [component]  [check]  [✓/✗]

---

PHASE 4 — DECISION LOGIC CONSISTENCY
  Test: Does the Auto-Yes suppression logic fire correctly from all sources?
  Method: trace the suppression logic statically through all components

  4a. NCSIntervalBadge suppression
      Check: shouldSuppressAutoYes() exported ✓/✗
      Check: suppression fires when band width > 15 ✓/✗
      Check: suppression visually greys Auto-Yes (not disables) ✓/✗

  4b. FailureModePanel suppression
      Check: BLOCK status suppresses Auto-Yes ✓/✗
      Check: "Blocked: FM[n] [name]" label shown ✓/✗
      Check: Red left border on parent card when BLOCK ✓/✗

  4c. StressTestGauge suppression
      Check: FAIL (> 25%) suppresses Auto-Yes ✓/✗
      Check: suppression label shown ✓/✗

  4d. LiveNCSTracker suppression
      Check: degraded (> 8pt drop) downgrades Auto-Yes → Conditional in display ✓/✗
      Check: does NOT modify execution logic ✓/✗

  4e. Suppression independence
      Check: each suppression source is independent (all must pass, not just one) ✓/✗
      Check: no suppression source modifies sacred files ✓/✗

  Print Phase 4 summary:
  PHASE 4: DECISION LOGIC
  [item]  [✓/✗]  [detail if ✗]

---

PHASE 5 — NOTIFICATION WIRING
  Test: Are all 7 notification triggers correctly wired?
  Method: static search for sendAlert() / notification trigger calls

  5a. NCS calibration completed        → search for trigger in calibration flow ✓/✗
  5b. Signal weights shifted            → search for trigger in meta-model ✓/✗
  5c. Signal audit completed            → search for trigger in signal-audit API ✓/✗
  5d. Danger level crosses 0.75         → search for trigger in danger-level API ✓/✗
  5e. NCS degrading intraday > 8pts     → search in LiveNCSTracker + notifications/route ✓/✗
  5f. RL EXIT EARLY > 80%               → search for trigger in rl-action API ✓/✗
  5g. TDA regime divergence             → search for trigger in TDARegimeBadge + notifications ✓/✗

  For each: note the exact file and line where the trigger fires.

  Print Phase 5 summary:
  PHASE 5: NOTIFICATIONS
  [trigger]  [✓/✗]  [file:line or "not found"]

---

PHASE 6 — DATA FLOW INTEGRITY
  Test: Does signal data flow correctly from computation → storage → display?
  Method: trace each signal's data path end-to-end

  6a. NCS → Conformal Interval → NCSIntervalBadge
      Trace: dual-score.ts output → conformal-calibrator.ts → /api/prediction/interval
             → NCSIntervalBadge props
      Check: no data transformation breaks the shape ✓/✗

  6b. Scan Result → Lead-Lag → GNN → GNNPropagationBadge
      Trace: LeadLagEdge table → lead-lag-graph.ts → gnn-scorer.ts
             → /api/prediction/gnn-score → GNNPropagationBadge
      Check: edge cases — no edges for ticker returns gracefully ✓/✗

  6c. InvarianceAuditResult → signal-weight-meta-model.ts → NCS adjustment
      Trace: InvarianceAuditResult → applyInvariancePenalty() → weight vector
             → NCS API layer
      Check: penalty applied after dynamic weighting, before NCS display ✓/✗

  6d. ThreatLibraryEntry → danger-matcher.ts → DangerLevelIndicator
      Trace: ThreatLibraryEntry → environment-encoder.ts → danger-matcher.ts
             → /api/prediction/danger-level → DangerLevelIndicator
      Check: empty threat library returns dangerScore=0 gracefully ✓/✗

  6e. TradeEpisode → PolicyVersion → RLTradeAdvisor
      Trace: TradeEpisode table → rl-trade-manager.ts → /api/prediction/rl-action
             → RLTradeAdvisor
      Check: no episodes returns HOLD with low confidence gracefully ✓/✗

  6f. TradePulse synthesis
      Trace: all signal APIs → trade-pulse-synthesiser.ts → /api/prediction/trade-pulse
             → TradePulseDashboard
      Check: Promise.all used (parallel, not sequential) ✓/✗
      Check: partial failures (one signal API down) handled gracefully ✓/✗

  Print Phase 6 summary:
  PHASE 6: DATA FLOW
  [flow]  [✓/✗]  [detail if ✗]

---

AFTER ALL PHASES COMPLETE:

Print full validation report:

═══════════════════════════════════════════
HYBRIDTURTLE END-TO-END VALIDATION REPORT
═══════════════════════════════════════════
Phase 1 — Data Layer:          [N/5 passed]
Phase 2 — API Routes:          [N/16 passed]
Phase 3 — Component Wiring:    [N/checks passed]
Phase 4 — Decision Logic:      [N/checks passed]
Phase 5 — Notifications:       [N/7 passed]
Phase 6 — Data Flow:           [N/6 passed]

CRITICAL ISSUES (must fix before live trading):
  [list any MISSING routes, broken data flows, or suppression logic failures]

NON-CRITICAL ISSUES (fix before next sprint):
  [list shape mismatches, stale data warnings, empty tables]

READY FOR LIVE TRADING: YES / NO
  If NO: list the specific items that must be resolved first.

Sacred files modified: NONE
═══════════════════════════════════════════

If any CRITICAL ISSUES are found: do not attempt to fix them in this session.
Print them clearly and stop. Fixes to critical issues require their own
dedicated prompt session to avoid rushed changes near execution logic.

If only NON-CRITICAL issues are found: you may proceed to fix them
following the same patterns already established in the codebase.
```

---

# TASK 4: CLAUDE.md Update Prompt

Paste this into Claude Code as a separate session AFTER Task 3 is complete.

---

```
TASK: Update CLAUDE.md to reflect the current state of HybridTurtle including
all prediction engine additions. CLAUDE.md is the agent context file read at
the start of every Claude Code session — it must be accurate or future sessions
will work from wrong assumptions.

BEFORE WRITING:
  Read CLAUDE.md in full (current state)
  Read SYSTEM-BREAKDOWN.md (regenerated version — source of truth)
  Read src/types/index.ts (sacred file list, constants)
  Read prisma/schema.prisma (table count)
  Read src/lib/ directory listing (module count)
  Read src/app/ directory listing (page count)

SACRED FILES — NEVER MODIFY:
  stop-manager.ts · position-sizer.ts · risk-gates.ts ·
  regime-detector.ts · dual-score.ts · scan-engine.ts
  (CLAUDE.md itself is not sacred but must be accurate)

---

SECTIONS TO UPDATE IN CLAUDE.md:

1. SYSTEM OVERVIEW
   Update to reflect:
   - Correct page count (was 22 — verify current count)
   - Correct API route count
   - Correct DB table count (21 core + 17 prediction = 38 total)
   - Add mention of prediction engine as a distinct architectural layer

2. SACRED FILES
   This section must remain unchanged:
   - stop-manager.ts
   - position-sizer.ts
   - risk-gates.ts
   - regime-detector.ts
   - dual-score.ts
   - scan-engine.ts
   Verify no additional files have been informally treated as sacred
   and should be added. If signal-weight-meta-model.ts or
   conformal-calibrator.ts are being treated as effectively sacred
   in practice, note them as "handle with care" files.

3. ARCHITECTURE LAYERS
   Add or update a section describing the two-layer architecture:

   Layer 1 — Core Trading Engine (sacred):
     scan-engine → dual-score → risk-gates → position-sizer → stop-manager
     regime-detector feeds all layers
     Never modified. All prediction work is post-processing only.

   Layer 2 — Prediction Engine (new):
     Sits entirely above Layer 1 as post-processing
     Wraps NCS output — never replaces it
     Components: conformal intervals, failure modes, dynamic weights,
     stress test, signal pruning, immune memory, lead-lag/GNN,
     Bayesian NCS, Kelly multiplier, Meta-RL advisor, VPIN,
     sentiment fusion, TDA regime, execution quality, TradePulse
     Causal invariance penalty feeds back into Layer 2 weights only

4. KEY DESIGN DECISIONS
   Add or verify these are documented:
   - Auto-Yes suppression is advisory display only — never touches execution
   - RL advisor is shadow mode by default — never fires orders autonomously
   - Kelly multiplier is opt-in — default OFF in settings
   - Conformal intervals are post-processing — dual-score.ts unchanged
   - Invariance penalty applied AFTER dynamic weighting, BEFORE display
   - Monday hard block on new entries — enforced in code, not just UI
   - Wednesday–Friday opportunistic entries require higher bar than Tuesday

5. PREDICTION ENGINE — QUICK REFERENCE
   Add a new section with a one-line description of each prediction component,
   its file location, and what it reads/writes:

   Format:
   | Component | File | Reads | Writes |
   |-----------|------|-------|--------|
   | Conformal Intervals | lib/prediction/conformal-calibrator.ts | ScanResult | ConformalCalibration |
   ... (one row per prediction component)

   This table is the most important addition — future Claude Code sessions
   need to know what exists before building anything new.

6. WORKFLOW REMINDER
   Verify the weekly execution workflow section is accurate:
   - Sunday: PLANNING (scan available)
   - Monday: OBSERVATION (new entries BLOCKED)
   - Tuesday: EXECUTION (primary entry day)
   - Wednesday–Friday: MAINTENANCE (higher bar for opportunistic entries)

7. TESTING REMINDER
   Add a note that before any sacred file change (which should essentially
   never happen), the full Vitest test suite must pass. List the test
   coverage areas so future agents don't duplicate test files.

8. PROMPT DISCIPLINE REMINDER
   Keep or add the existing reminder:
   - Read before writing. Always.
   - Never hardcode values that belong in constants
   - Server-side enforcement mirrors UI enforcement
   - Match existing patterns before inventing new ones
   - Never modify sacred files under any circumstance

---

ACCURACY RULES:
  All counts (pages, routes, tables) must be verified from actual code
  Do not carry forward numbers from the old CLAUDE.md without verifying
  If uncertain about a detail, mark it "(verify)" rather than guessing

FORMATTING:
  Match the existing CLAUDE.md style exactly
  Do not restructure sections that don't need updating
  Add new sections at the end unless they logically belong elsewhere

When complete, print:
CLAUDE.md UPDATED
Sections modified: [N]
Sections added: [N]
Key addition: Prediction Engine quick-reference table ([N] components)
```
