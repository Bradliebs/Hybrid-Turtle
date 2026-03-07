# Claude Code Prompt — Regenerate SYSTEM-BREAKDOWN.md

Paste this entire prompt into Claude Code.

---

```
TASK: Regenerate SYSTEM-BREAKDOWN.md to reflect the true current state of the 
codebase. The existing file is outdated (dated 4 March 2026) and predates 
significant additions. The new file replaces it entirely.

BEFORE WRITING ANYTHING:
Read the following in full — do not write a single line until all reading is done:

  CLAUDE.md
  prisma/schema.prisma                        (all tables)
  src/types/index.ts                          (all types, constants, profiles)
  src/app/ (directory listing, 2 levels)      (all pages and routes)
  src/lib/ (directory listing)                (all lib modules)
  src/lib/modules/ (directory listing)        (all trading modules)
  src/components/ (directory listing)         (all component folders)
  src/cron/nightly.ts                         (pipeline steps)
  src/cron/midday-sync.ts
  src/cron/watchdog.ts
  src/store/useStore.ts
  src/middleware.ts
  The existing SYSTEM-BREAKDOWN.md            (as a structural template only)

  Then read each page file to extract its components and purpose:
  src/app/dashboard/page.tsx
  src/app/scan/page.tsx
  src/app/scan/scores/page.tsx
  src/app/scan/cross-ref/page.tsx
  src/app/plan/page.tsx
  src/app/portfolio/positions/page.tsx
  src/app/portfolio/distribution/page.tsx
  src/app/risk/page.tsx
  src/app/settings/page.tsx
  src/app/trade-log/page.tsx
  src/app/journal/page.tsx
  src/app/performance/page.tsx
  src/app/backtest/page.tsx
  src/app/notifications/page.tsx
  src/app/signal-audit/page.tsx
  src/app/causal-audit/page.tsx
  src/app/execution-quality/page.tsx
  src/app/trade-pulse/page.tsx
  src/app/trade-pulse/[ticker]/page.tsx

SACRED FILES — DO NOT MODIFY:
  stop-manager.ts · position-sizer.ts · risk-gates.ts
  regime-detector.ts · dual-score.ts · scan-engine.ts

---

OUTPUT: A single file — SYSTEM-BREAKDOWN.md — written to the project root.
Overwrite the existing file completely.

STRUCTURE TO FOLLOW (match the existing file's section numbering and style,
but update every section to reflect current reality):

## 1. What It Is
  - Keep the description accurate to current state
  - Update stack if anything has changed
  - Update page count to actual current count

## 2. Screens (N Pages)
  - One sub-section per page, in the same format as the existing file
  - For each page: list actual components imported/used, describe what it shows
  - Include ALL pages found in src/app/ — do not omit any
  - For prediction engine pages (signal-audit, causal-audit, execution-quality,
    trade-pulse) write full descriptions based on reading the actual page files
  - Mark any page that is NEW since the previous breakdown with: *(added)*

## 3. API Routes
  - Rebuild the full table from src/app/api/ directory listing
  - Include ALL routes found — do not omit prediction engine routes
  - Group by: Core routes / Prediction Engine routes / Utility routes
  - For each route: method(s) + one-line purpose

## 4. Core Lib Modules
  - Sacred files section: unchanged descriptions (these are sacred)
  - Important support files: rebuild from actual src/lib/ contents
  - For any new lib files added by the prediction engine: add them with accurate
    descriptions based on reading the file headers/exports
  - Mark new files with: *(added)*

## 5. Trading Modules
  - Rebuild from src/lib/modules/ directory listing
  - Keep existing descriptions where module files are unchanged
  - Add any new modules with accurate descriptions

## 6. Nightly Automation
  - Read nightly.ts and rebuild the step table accurately
  - Note if any new steps were added by the prediction engine
  - Keep midday-sync and watchdog descriptions accurate

## 7. Database Schema
  - Rebuild the full table from prisma/schema.prisma
  - Keep the two-section structure: Core tables / Prediction Engine tables
  - For each table: accurate one-line purpose
  - Count total tables and state it in the section header
  - Mark any tables that are NEW since previous breakdown with: *(added)*

## 8. Data Flow Summary
  - Keep the ASCII diagram style
  - Update to include prediction engine data flows where relevant
  - Ensure the diagram reflects actual current architecture

## 9. Weekly Workflow
  - Unchanged unless types/index.ts or phase logic has changed
  - Verify against actual code before including

## 10. Risk Profiles
  - Read from types/index.ts — use actual current values
  - Mark active profile accurately

## 11. Stop Manager — Monotonic Ladder
  - Read from stop-manager.ts (read only) — use actual current thresholds
  - Keep the "Stops ratchet up only" note

## 12. The 6 Risk Gates
  - Read from risk-gates.ts (read only) — use actual current gates
  - Verify values against current SMALL_ACCOUNT profile

## 13. Dual Score System
  - Read from dual-score.ts (read only) — verify BQS/FWS/NCS formula
  - Update if any scoring additions were made

## 14. Prediction Engine (NEW SECTION — was not in previous breakdown)
  Write a new section covering:
  - Conformal Prediction (Phase 1): what it does, calibration strategy
  - Failure Mode Scoring (Phase 2): 5 modes, rejection logic
  - Dynamic Signal Weighting (Phase 3): meta-model, context vector
  - Adversarial Stress Test (Phase 4): Monte Carlo, gate thresholds
  - Signal Pruning / MI Analysis (Phase 5): mutual information, output
  - Immune System / Danger Memory (Phase 6): threat library, matching
  - Lead-Lag Graph (Phase 7): cross-asset edges, NCS adjustment
  - GNN on Lead-Lag (F1): GraphSAGE, propagation score
  - Online Bayesian NCS (F2): Beta distributions, belief states
  - Fractional Kelly (F3): conviction scorer, uncertainty penalty
  - Meta-RL Trade Manager (F4): MAML, trade episodes, shadow mode
  - VPIN / Order Flow (F5): bulk classification, informed trading signal
  - Sentiment Fusion (F6): news RSS + options PCR, fuser logic
  - TDA Regime Detector (F7): Takens embedding, persistence approximation
  - Execution Quality Loop (F8): slippage analyser, timing recommender
  - TradePulse Dashboard (F9): synthesis layer, grade mapping
  - Causal Invariance / IRM (bonus): what it does, where results live

  For each: 2–4 sentences. Technical but concise. Based on actual code, not spec.

## 15. State Management
  - Verify against current useStore.ts and middleware.ts
  - Update if anything has changed

## 16. Shared Components
  - Read src/components/shared/ — list all shared components with purpose
  - Add any new shared components added by prediction engine work
  - Mark new ones with: *(added)*

## 17. Testing
  - Read Vitest test files (directory listing) — update coverage areas
  - Note any new test files added

## 18. Deployment & Scripts
  - Read project root for .bat files — list all with purpose
  - Include any new scripts added

## 19. File Structure Overview
  - Rebuild the tree from actual current directory structure
  - Include prediction engine folders (lib/prediction/, lib/signals/, lib/sentiment/)
  - Keep the same ASCII tree style as existing file
  - Update table counts (pages, routes, tables, etc.) to be accurate

---

FORMATTING RULES:
  - Match the existing file's markdown style exactly
  - Use the same table formatting, code blocks, and heading levels
  - Every section header matches the existing file's style
  - Update "Last updated:" footer to today's date
  - Do not add sections not listed above
  - Do not remove sections listed above
  - Do not add commentary or caveats — this is a reference document, not a report

ACCURACY RULES:
  - Every number (page count, table count, route count) must be counted from
    actual code — do not estimate or carry over from the old file
  - If a file is not found where expected, note it as "(not found)" 
    rather than omitting or guessing
  - If a description is uncertain, mark it "(verify)" rather than guessing
  - Sacred file descriptions are authoritative — do not alter them

When complete, print:
SYSTEM-BREAKDOWN.md REGENERATED
Pages: [N]
API routes: [N]  
DB tables: [N]
Lib modules: [N]
Last updated: [today's date]
```
