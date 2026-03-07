# Claude Code Prompt — UI Gap Audit & Build
## HybridTurtle: Find and Fill All Missing UI Components

---

## Paste this entire prompt into Claude Code

---

```
BEFORE WRITING ANY CODE:
1. Read CLAUDE.md in full
2. Read every file listed under "Files to Read First" below
3. Do not write a single line of code until the audit in Step 1 is complete

SACRED FILES — NEVER MODIFY UNDER ANY CIRCUMSTANCE:
- stop-manager.ts
- position-sizer.ts
- risk-gates.ts
- regime-detector.ts
- dual-score.ts
- scan-engine.ts

---

TASK OVERVIEW:
This is a two-step task.

STEP 1 — AUDIT (read-only, no code written):
  Systematically check whether each component and page listed below
  exists in the codebase and matches its specification.
  For each item, determine one of:
    EXISTS_COMPLETE   — component exists and matches spec
    EXISTS_PARTIAL    — component exists but is missing behaviour described in spec
    MISSING           — component does not exist at all

  Output a structured audit report to the terminal before proceeding.
  Format:
    [EXISTS_COMPLETE]  NCSIntervalBadge           components/NCSIntervalBadge.tsx
    [EXISTS_PARTIAL]   FailureModePanel            components/FailureModePanel.tsx — missing: BLOCK border on card
    [MISSING]          StressTestGauge             not found

  Do not proceed to Step 2 until the full audit report is printed.

STEP 2 — BUILD (only items marked EXISTS_PARTIAL or MISSING):
  For each gap found in Step 1, build or complete the missing UI.
  Work through items in the order they appear in the spec list below.
  After completing each item, print: [BUILT] ComponentName
  Never modify sacred files.
  Never modify existing complete components — only add or extend.

---

FILES TO READ FIRST (before audit begins):
  CLAUDE.md
  components/ (list all files — understand what already exists)
  app/ (list all pages — understand routing)
  lib/prediction/ (list all files — understand what signals are available)
  lib/signals/ (list all files)
  lib/sentiment/ (list all files)
  lib/execution/ (list all files)
  prisma/schema.prisma

---

COMPONENT SPEC LIST (audit every item below):

─────────────────────────────────────────────
TICKER CARD COMPONENTS (appear in TodayPanel)
─────────────────────────────────────────────

1. NCSIntervalBadge  →  components/NCSIntervalBadge.tsx
   Spec:
   - Displays NCS point score + interval range e.g. "67.3 [61.1 – 73.5]"
   - Colour-coded confidence band alongside:
       width < 8  → green band
       width 8–15 → amber band
       width > 15 → red band
   - When band is red: Auto-Yes button visually suppressed (greyed, not disabled)
   - Reads from conformal interval API
   - Shows raw NCS and lead-lag-adjusted NCS if adjustment exists:
       "NCS: 67.3 → 74.3 (+7 lead-lag)"
   - Adjustment shown in distinct blue colour, separate from interval band

2. FailureModePanel  →  components/FailureModePanel.tsx
   Spec:
   - Collapsed by default, expandable
   - Collapsed: single line — green tick if all pass, amber/red if warn/block
       e.g. "Failure Modes: ✓ All clear  [expand ▾]"
   - Expanded: one row per failure mode (FM1–FM5)
       Each row: icon · name · score bar (0–100) · PASS / WARN / BLOCK badge
   - If any FM is BLOCK: entire parent ticker card gets a red left border
   - If any FM is BLOCK: Auto-Yes suppressed with label "Blocked: FM[n] [name]"
   - WARN states shown in amber — do not block, inform only

3. SignalWeightPanel  →  components/SignalWeightPanel.tsx
   Spec:
   - System-level (not per-ticker) — lives in TodayPanel header/status bar
   - Collapsible bar chart of current dynamic weight vector (7 bars)
   - Labels: ADX · DI · Hurst · BIS · DRS · wADX · BPS
   - Regime label shown alongside: TRENDING / RANGING / VOLATILE / TRANSITION
   - Tooltip on each bar: "ADX weighted 0.20 this scan (vs 0.16 baseline)"
   - Subtle animation when weights shift significantly between scans

4. StressTestGauge  →  components/StressTestGauge.tsx
   Spec:
   - Shown only on Conditional and Auto-Yes ticker cards (not Auto-No)
   - Displays stop-hit probability as a dial/progress bar
   - Colour: green < 25% / amber 25–35% / red > 35%
   - Runs on-demand via "Run Stress Test" button — not automatic
   - Result cached with timestamp shown: "4h ago"
   - If FAIL (>25%): Auto-Yes suppressed, label: "Stress Test: FAIL — 38% adversarial stop-hit"
   - Calls: /api/prediction/stress-test

5. DangerLevelIndicator  →  components/DangerLevelIndicator.tsx
   Spec:
   - PERSISTENT — lives in top navigation bar, always visible
   - 5-segment indicator:
       [■□□□□] Market: Normal
       [■■■□□] Market: Elevated Risk ⚠
       [■■■■■] Market: Danger Zone 🔴
   - Clicking opens a drawer showing:
       dangerScore (0–100)
       Top 3 closest threat library matches with similarity %
       Which environmental factors are triggering the match
       Historical danger level chart (last 30 days)
   - When dangerScore > 0.75: all ticker cards gain subtle amber background tint
   - When dangerScore > 0.90: TodayPanel shows full-width banner:
       "⚠ High danger environment detected. New entries are higher risk than usual."
   - Calls: /api/prediction/danger-level

6. LeadLagPanel  →  components/LeadLagPanel.tsx
   Spec:
   - Per-ticker card, collapsed by default
   - Collapsed: "Lead-Lag: N upstream signals active  [+X NCS] ▾"
   - Expanded: table of upstream assets with:
       ticker · movement % · days ago · NCS impact (+/-)
   - Calls: /api/prediction/lead-lag

7. GNNPropagationBadge  →  components/GNNPropagationBadge.tsx
   Spec:
   - Per-ticker card
   - Shows score + connectivity icon: "GNN: 74  ◉ Network signal strong"
   - Green (>65) / Amber (45–65) / Grey (<45 or UNVALIDATED)
   - UNVALIDATED when weights > 7 days stale — shown with grey strikethrough badge
   - Tooltip: "Based on N upstream nodes moving over last 2 days"
   - Calls: /api/prediction/gnn-score

8. LiveNCSTracker  →  components/LiveNCSTracker.tsx
   Spec:
   - Per-ticker card, visible during trading hours only
   - Shows: prior NCS → posterior NCS + directional arrow + update count
       Stable:    "NCS: 72.0 → 72.0  ─  (12 updates)"
       Degrading: "NCS: 72.0 → 63.4  ↓  ⚠ Degrading intraday"
   - If degraded: amber warning + "Auto-Yes → Conditional intraday" reclassification label
   - Resets at session start each day
   - Controlled by settings toggle: "Show intraday NCS updates"
   - Calls: /api/prediction/bayesian-update (reads state, does not trigger update)

9. VPINBadge  →  components/VPINBadge.tsx
   Spec:
   - Per-ticker card
   - INFORMED_BUYING:  green badge "VPIN: [score] ↑ Informed Buying"
   - INFORMED_SELLING: red badge with warning icon (most prominent state)
                       also triggers -15 NCS adjustment shown on NCSIntervalBadge
   - UNINFORMED:       grey "Low VPIN"
   - NEUTRAL:          no badge shown (intentional — keep card clean)
   - Calls: /api/signals/vpin

10. SentimentFusionBadge  →  components/SentimentFusionBadge.tsx
    Spec:
    - Per-ticker card — shown on CONDITIONAL trades only, not Auto-Yes or Auto-No
    - BULLISH:  green "Sentiment ↑" + score breakdown on hover
    - BEARISH:  amber "Sentiment ↓" + warning tone
    - MIXED:    grey "Mixed signals"
    - Low confidence (< 0.6): no badge shown
    - Calls: /api/sentiment/score

11. TDARegimeBadge  →  components/TDARegimeBadge.tsx
    Spec:
    - System-level — lives in TodayPanel header/status bar alongside SignalWeightPanel
    - STABLE + agrees with primary:  small green "TDA ✓ Stable"
    - TRANSITIONING:                 amber "TDA ⚠ Transition forming"
    - TURBULENT:                     red "TDA ✗ Turbulent"
    - transitionWarning=true:        amber pulsing badge + "⚡ Early warning" label
    - When transitionWarning=true: full-width banner in TodayPanel:
        "⚡ TDA early warning: topological complexity rising while trend indicators
         positive. Heightened caution advised."
    - Calls: /api/prediction/tda-regime

─────────────────────────────────────────────
EXECUTION SCREEN COMPONENTS
─────────────────────────────────────────────

12. KellySizingAdvisor  →  components/KellySizingAdvisor.tsx
    Spec:
    - Appears on pre-trade execution confirmation screen (before placing buy order)
    - When Kelly OFF (default):
        Shows advisory row greyed out:
        "Kelly Advisor: £272 suggested (0.80×)  [greyed]"
    - When Kelly ON:
        Shows applied adjustment:
        "Kelly Advisor: £272 applied (0.80×)  ✓"
        Breakdown tooltip: interval score / stress score / GNN score
        Base size shown as strikethrough, adjusted size shown prominently
    - Controlled by settings toggle: "Apply Kelly multiplier to sizing" (default OFF)
    - Calls: /api/prediction/kelly-multiplier

─────────────────────────────────────────────
OPEN POSITION CARD COMPONENTS
─────────────────────────────────────────────

13. RLTradeAdvisor  →  components/RLTradeAdvisor.tsx
    Spec:
    - Appears on open position cards (not scan candidates)
    - Action badge states:
        HOLD        → grey badge
        TIGHTEN     → amber badge
        TRAIL       → green badge
        EXIT EARLY  → red pulsing badge (most prominent)
    - Confidence bar: Q-value margin over second-best action
    - Mini timeline: last 5 RL recommendations for this trade
    - When shadow mode OFF: TIGHTEN/TRAIL pre-fills stop update UI for confirmation
    - Controlled by settings toggle: "RL Shadow Mode" (default ON)
    - Calls: /api/prediction/rl-action

─────────────────────────────────────────────
TICKER CARD: F9 ENTRY POINT
─────────────────────────────────────────────

14. TradePulseScore (grade pill)  →  components/TradePulseScore.tsx
    Spec:
    - Small pill badge shown on each Auto-Yes and Conditional ticker card
    - Displays grade only: A+ / A / B / C / D
    - Colour: A+/A → green · B → blue · C → amber · D → red
    - Links to /trade-pulse/[ticker] on click
    - "Full Analysis →" text link also added to bottom of each Conditional/Auto-Yes card

─────────────────────────────────────────────
FULL-PAGE COMPONENTS
─────────────────────────────────────────────

15. TradePulseDashboard  →  components/TradePulseDashboard.tsx
                            app/trade-pulse/[ticker]/page.tsx
    Spec:
    - Full-page dashboard for a single ticker
    - Hero: large score dial (0–100) + grade badge (A+ through D)
    - Decision bar: AUTO_YES / CONDITIONAL / AUTO_NO with confidence shading
    - Signal grid (3 columns × 4 rows): one card per contributing signal
        Each signal card: icon · name · score or status · one-word label
        Detail in tooltip / expandable row
    - Concerns panel: flagged issues in red/amber (listed before opportunities)
    - Opportunity panel: confirming signals in green
    - Kelly advisor row: base size → suggested size with multiplier
    - RL recommendation badge
    - Footer: computed at [time] · next scan [time] · [N] signals evaluated
    - Stale indicator if data > 30 minutes old
    - Calls: /api/prediction/trade-pulse (which aggregates all signal APIs via Promise.all)
    - Target response time: < 500ms

─────────────────────────────────────────────
NEW PAGES (check routing exists)
─────────────────────────────────────────────

16. /signal-audit  →  app/signal-audit/page.tsx
    Spec:
    - 7×7 MI heatmap (pairwise mutual information)
    - Bar chart: conditional MI per signal
    - Recommendation table: KEEP / INVESTIGATE / REDUNDANT per signal
    - Last run timestamp + manual "Run Analysis" button
    - CSV export button
    - Listed in sidebar under "System" section

17. /execution-quality  →  app/execution-quality/page.tsx
    Spec:
    - Summary cards: avg slippage %, best execution window, worst-fill tickers
    - Bar chart: avg slippage by hour of day
    - Line chart: slippage trend over time
    - Table: worst 10 fills (ticker · date · slippage % · context)
    - Recommendation panel: timing recommendations by market cap tier
    - Listed in sidebar under "Performance" section
    - Pre-trade execution screen addition:
        "Intended risk: 2.0% | Effective risk (avg slippage): ~2.3%"
        "Best execution window: 10:00–11:30 GMT [currently: ✓ within window]"

18. /trade-pulse/[ticker]  →  app/trade-pulse/[ticker]/page.tsx
    (covered by item 15 above — check routing separately)

─────────────────────────────────────────────
SETTINGS PANEL ADDITIONS (check all exist)
─────────────────────────────────────────────

19. Settings: "Show intraday NCS updates"
    Location: Display Settings section
    Default: ON
    Controls: LiveNCSTracker visibility

20. Settings: "Apply Kelly multiplier to sizing"
    Location: Risk Settings section
    Default: OFF
    Controls: KellySizingAdvisor active/advisory mode

21. Settings: "RL Shadow Mode"
    Location: Execution Settings section
    Default: ON
    Controls: RLTradeAdvisor advisory vs active mode

─────────────────────────────────────────────
NAVIGATION / SIDEBAR ADDITIONS (check all exist)
─────────────────────────────────────────────

22. Sidebar: "Signal Audit" link → /signal-audit
    Section: System

23. Sidebar: "Execution Quality" link → /execution-quality
    Section: Performance

24. Sidebar: "Trade Pulse" link → /trade-pulse
    Section: Analysis

─────────────────────────────────────────────
NOTIFICATION CENTRE TRIGGERS (check all wired)
─────────────────────────────────────────────

25. NCS calibration completed          → Info notification
26. Signal weights shifted             → Info notification
27. Signal audit completed             → Info notification
28. Danger level crosses 0.75          → Warning notification
    Message: "Market environment pattern-matches historical danger period
    [threat name] similarity: [N]%"
29. NCS degrading intraday > 8pts      → Warning notification
    Message: "NCS degrading: [ticker] [prior]→[posterior] — consider holding entry"
30. RL EXIT EARLY confidence > 80%     → Warning notification
    Message: "RL advisor recommends early exit: [ticker] — [N]% confidence"
31. TDA regime divergence              → Warning notification
    Message: "TDA regime divergence detected — possible early transition signal"

---

BUILD INSTRUCTIONS (Step 2):

For each MISSING or EXISTS_PARTIAL item found in the audit:

1. Read the relevant API route file before building the component
   (to understand exact response shape — never assume)

2. Follow existing component patterns exactly:
   - Match file structure, import style, prop typing conventions
   - Use existing design system tokens for colours, spacing, typography
   - Never hardcode colour hex values — use existing CSS variables or Tailwind classes
   - Never hardcode threshold values — import from existing constants files

3. For components that appear on the ticker card:
   - Read the existing TodayPanel ticker card component first
   - Integrate following the same conditional rendering patterns already present
   - Do not restructure or reorder existing card elements

4. For new pages:
   - Read an existing page (e.g. the performance page or journal page)
     for routing, layout, and data-fetching patterns
   - Follow the same pattern exactly

5. For settings additions:
   - Read the existing settings panel component
   - Add new toggles in the correct section without restructuring existing settings

6. For notification triggers:
   - Read the existing notification centre implementation
   - Wire new triggers following the exact same pattern

7. After completing each item, print: [BUILT] [item number] [ComponentName]

8. After all items are complete, print a final summary:
   AUDIT COMPLETE
   Existing and complete: [N]
   Fixed (partial → complete): [N]
   Built from scratch: [N]
   Total gaps filled: [N]

---

FINAL REMINDERS:
- Read before writing. Always.
- Never modify sacred files.
- Never restructure existing complete components.
- If an API route is missing for a component, build the route first, then the component.
- If uncertain about a design decision, match the closest existing pattern in the codebase.
- Server-side enforcement must mirror any UI enforcement.
```
