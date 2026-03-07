# HybridTurtle — Non-Critical Gap Fix Prompt
## Closes 5 wiring gaps found in end-to-end validation

Paste this into Claude Code as a standalone session.

---

```
TASK: Fix 5 non-critical wiring gaps identified in the end-to-end validation.
These are display-layer wiring gaps only — no logic changes, no sacred file
modifications, no execution flow changes.

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md in full
2. Read every "Files to Read First" listed per item below
3. Do not write code until you have read the relevant files

SACRED FILES — NEVER MODIFY:
stop-manager.ts · position-sizer.ts · risk-gates.ts ·
regime-detector.ts · dual-score.ts · scan-engine.ts

---

FIX ITEM 1 — VPINBadge not integrated into TodayPanel ticker cards

Files to read first:
  src/components/plan/TodayPanel.tsx (or wherever ticker cards are rendered)
  src/components/VPINBadge.tsx
  src/app/api/signals/vpin/route.ts (understand response shape)

Fix:
  - Import VPINBadge into the ticker card component
  - Fetch VPIN score per ticker using existing data-fetch pattern in the card
  - Render VPINBadge on each ticker card
  - NEUTRAL signal → render null (no badge) — this is intentional per spec
  - INFORMED_SELLING → show red badge even on collapsed card state
  - Position: in the signal quality section of the card, after GNNPropagationBadge

---

FIX ITEM 2 — SentimentPanel not integrated into TodayPanel ticker cards

Files to read first:
  src/components/plan/TodayPanel.tsx (or ticker card component)
  src/components/SentimentPanel.tsx
  src/app/api/signals/sentiment/route.ts

Fix:
  - Import SentimentPanel (SentimentFusionBadge) into ticker card
  - Render ONLY on CONDITIONAL trade cards — not Auto-Yes, not Auto-No
  - This is a conditional render based on the ticker's decision status
  - Hide when confidence < 0.6 (component handles this internally — verify)
  - Position: below VPINBadge in the signal quality section

---

FIX ITEM 3 — LiveNCSTracker not integrated into TodayPanel ticker cards

Files to read first:
  src/components/plan/TodayPanel.tsx (or ticker card component)
  src/components/LiveNCSTracker.tsx
  src/app/api/prediction/beliefs/route.ts (this is the Bayesian update route)
  src/store/useStore.ts (check for "showIntradayNCSUpdates" setting)

Fix:
  - Import LiveNCSTracker into ticker card
  - Only render during trading hours (Mon–Fri, 08:00–16:30 London time)
    Use: const isMarketHours = ... check existing pattern in codebase
  - Controlled by "Show intraday NCS updates" setting (default ON)
    Read setting from useStore or settings API — match existing pattern
  - Position: directly below the NCSIntervalBadge (prior → posterior flow)
  - Resets at session start — verify reset logic is in the component

---

FIX ITEM 4 — TDARegimeBadge not in Navbar / system status bar

Files to read first:
  src/components/shared/Navbar.tsx
  src/components/TDARegimeBadge.tsx
  src/app/api/prediction/tda-regime/ (check if route exists — see Fix Item 5)

Note: Fix Item 5 (missing API route) must be completed before this item
if the route does not exist. Check first.

Fix:
  - Import TDARegimeBadge into Navbar.tsx
  - Position: in the system status bar area of the Navbar, alongside
    any existing regime indicator
  - Read existing Navbar structure carefully — do not disrupt existing
    layout or responsive behaviour
  - TDARegimeBadge is a small badge (not a full panel) — it should sit
    compactly in the nav bar
  - When transitionWarning=true: the badge pulses amber — verify this
    CSS animation is scoped and does not affect other Navbar elements

---

FIX ITEM 5 — /api/prediction/tda-regime route missing (component-only)

Files to read first:
  src/components/TDARegimeBadge.tsx (understand what data it needs)
  src/lib/prediction/tda/tda-regime-detector.ts (understand output shape)
  src/app/api/prediction/danger-level/route.ts (use as API pattern)
  prisma/schema.prisma (TDARegimeSignal table)

Fix:
  Create: src/app/api/prediction/tda-regime/route.ts

  GET handler:
    - Query TDARegimeSignal table for most recent record
    - If no record: return { regimeLabel: 'STABLE', transitionWarning: false,
                             persistenceScore: 50, agreesWithPrimary: true,
                             computedAt: null }
    - If record exists: return full record fields
    - Response shape:
      {
        regimeLabel: 'STABLE' | 'TRANSITIONING' | 'TURBULENT',
        transitionWarning: boolean,
        persistenceScore: number,        // 0–100
        agreesWithPrimary: boolean,
        primaryRegime: string,
        computedAt: string | null
      }
    - Follow existing auth middleware pattern
    - Follow existing error handling pattern (apiError())

  Note: TDA computation itself runs nightly via the nightly pipeline.
  This route is READ-ONLY — it returns the latest stored result.
  Do not add a POST/run endpoint — TDA runs on schedule, not on-demand.

---

FIX ITEM 6 — rlShadowMode setting not gated in PositionsTable RL badge

Files to read first:
  src/components/portfolio/PositionsTable.tsx (or wherever RLTradeAdvisor renders)
  src/components/RLTradeAdvisor.tsx (TradeAdvisorPanel)
  src/store/useStore.ts (check for rlShadowMode)
  src/app/settings/page.tsx (verify toggle exists)

Fix:
  - Read the "RL Shadow Mode" setting from useStore or settings API
  - Pass shadowMode prop to RLTradeAdvisor / TradeAdvisorPanel
  - When shadowMode=true (default): show advisory badge only,
    no pre-fill of stop update UI
  - When shadowMode=false: TIGHTEN/TRAIL recommendations pre-fill
    the stop update UI for user confirmation
  - The component likely already has shadowMode prop — verify it's
    being passed correctly from the parent, not hardcoded internally
  - Do not add any auto-execution logic — user confirmation is always
    required regardless of shadow mode setting

---

AFTER ALL FIXES COMPLETE:

Verify TypeScript compiles with 0 errors.

Print final summary:
WIRING GAPS FIXED
Item 1 VPINBadge integration:        [DONE/SKIPPED — reason]
Item 2 SentimentPanel integration:   [DONE/SKIPPED — reason]
Item 3 LiveNCSTracker integration:   [DONE/SKIPPED — reason]
Item 4 TDARegimeBadge in Navbar:     [DONE/SKIPPED — reason]
Item 5 TDA API route created:        [DONE/SKIPPED — reason]
Item 6 rlShadowMode gating:          [DONE/SKIPPED — reason]

Sacred files modified: NONE
TypeScript errors: 0

Note: Items 6, 7, 8 from validation report (empty DB tables) are
self-resolving — they will populate on the next nightly pipeline run.
No code changes required for those items.
```
