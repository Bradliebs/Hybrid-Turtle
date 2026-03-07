# HybridTurtle — Complete Interface Change Audit
## All Phases (1–7) + All Frontiers (F1–F9)

> A full map of every UI addition, modification, and new page across all 16 build phases.
> Use this as a design reference before building F9 (TradePulse Dashboard).

---

## Summary: What Gets Added Where

| Location | Changes Added By |
|---|---|
| TodayPanel — ticker card | P1, P2, P3, F2, F3, F5, F6 |
| TodayPanel — system status bar | P3, P6, F7 |
| Position card (open trades) | P4, F4, F2 |
| Execution flow / confirmation UI | P4, F3 |
| Nightly summary / notification centre | P1, P2, P5, P6, F7 |
| New standalone pages | P5, P7, F8, F9 |
| Settings panel | F2, F3, F4 |
| Navigation / sidebar | P5, F8, F9 |

---

## Phase-by-Phase UI Changes

---

### Phase 1 — Conformal Prediction Intervals on NCS

**Component added:** `NCSIntervalBadge`

**Where it appears:** Ticker card in TodayPanel, replacing the bare NCS number

**Before:**
```
NCS: 67.3   [AUTO-YES]
```

**After:**
```
NCS: 67.3 [61.1 – 73.5]  ■■■■□  [AUTO-YES]
         └─ amber band: medium uncertainty
```

**Visual changes:**
- NCS number now has an interval range appended in lighter text
- Colour-coded confidence band beside it:
  - Green = narrow (width < 8) — high conviction
  - Amber = medium (width 8–15)
  - Red = wide (width > 15) — treat as Conditional regardless of point score
- Auto-Yes button is visually suppressed (greyed, not disabled) when band is red

**Notification centre:** Nightly calibration run adds a log entry showing sample size and current q̂ values. No user-facing alert unless calibration fails.

---

### Phase 2 — Failure Mode Scoring

**Component added:** `FailureModePanel`

**Where it appears:** Below the NCS badge on each ticker card, collapsed by default, expandable

**Collapsed state:**
```
NCS: 67.3 [61.1–73.5]
Failure Modes: ✓ All clear   [expand ▾]
```

**Expanded state:**
```
FM1 Breakout Failure    42  ██░░░  PASS
FM2 Liquidity Trap      18  █░░░░  PASS
FM3 Correlation Cascade 71  ███░░  WARN
FM4 Regime Flip         38  ██░░░  PASS
FM5 Event Gap Risk      60  ███░░  WARN
```

**Visual changes:**
- Collapsed: single line with green tick (all pass) or amber/red indicator (warns/blocks)
- If any FM is BLOCK: entire ticker card gets a red left border
- Auto-Yes is suppressed if any FM is BLOCK — shown as "Blocked: FM2 Liquidity" label
- Warn states shown in amber but do not block — user informed only

**Notification centre:** No new alerts (failure modes are per-scan, surfaced in UI only)

---

### Phase 3 — Dynamic Signal Weighting Meta-Model

**Component added:** `SignalWeightPanel`

**Where it appears:** System status bar / header area of TodayPanel (not per-ticker — it's a system-level indicator)

**Appearance:**
```
Signal Weights  [TRENDING regime]
ADX ████░  DI ███░░  Hurst ██░░░  BIS ████░  DRS █████  wADX ███░░  BPS ██░░░
```

**Visual changes:**
- Small collapsible bar chart showing current dynamic weight vector
- Regime label shown alongside (TRENDING / RANGING / VOLATILE / TRANSITION)
- Weights update each scan — subtle animation when they shift significantly
- Tooltip on any bar: "ADX weighted 0.20 this scan (vs 0.16 baseline) — trending regime boost"
- No per-ticker impact on cards (weights are system-level)

**Notification centre:** Alert if weights shift dramatically between scans (regime transition detected via weight change): "Signal weights shifted significantly — possible regime transition"

---

### Phase 4 — Adversarial Stress Test Gate

**Component added:** `StressTestGauge`

**Where it appears:** Inside each ticker card, shown only for Conditional and Auto-Yes candidates (not Auto-No — no point running it)

**Appearance:**
```
Stress Test: 18% adversarial stop-hit probability  ●●●○○○○○○○  PASS
```

**Visual changes:**
- Dial / progress bar showing stop-hit probability under adversarial paths
- Green (< 25%) / Amber (25–35%) / Red (> 35%)
- Runs on-demand when user clicks "Run Stress Test" button on card — not automatic
- Once run, result cached and shown with timestamp ("4h ago")
- If result is FAIL: Auto-Yes suppressed, shown as "Stress Test: FAIL — 38% adversarial stop-hit"

**No new pages.** No navigation changes.

---

### Phase 5 — Information-Theoretic Signal Pruning

**New page:** `/signal-audit`

**Navigation:** Added to sidebar under "System" section as "Signal Audit"

**Page contents:**
- 7×7 MI heatmap (pairwise mutual information between signal layers)
- Bar chart: conditional MI per signal (how much unique information each adds)
- Recommendation table: KEEP / INVESTIGATE / REDUNDANT per signal
- Last run timestamp + "Run Analysis" button (manual trigger, not nightly)
- Export button: download audit report as CSV

**No changes to TodayPanel or position cards.** This is an analysis-only page.

**Notification centre:** One-time alert when first analysis completes: "Signal audit ready — 2 signals flagged for review"

---

### Phase 6 — Immune System / Market Danger Memory

**Component added:** `DangerLevelIndicator`

**Where it appears:** System-level — persistent indicator in the top navigation bar / header

**Appearance (low danger):**
```
[■□□□□] Market: Normal
```

**Appearance (elevated danger):**
```
[■■■□□] Market: Elevated Risk ⚠
```

**Appearance (high danger):**
```
[■■■■■] Market: Danger Zone 🔴
```

**Visual changes:**
- 5-segment ambient indicator always visible in header
- Clicking it opens a drawer showing:
  - Current dangerScore (0–100)
  - Top 3 closest threat library matches with similarity score
  - Which environmental factors are triggering the match
  - Historical danger level chart (last 30 days)
- When dangerScore > 0.75: all ticker cards gain a subtle amber background tint
- When dangerScore > 0.90: TodayPanel shows a full-width banner:
  "⚠ High danger environment detected. New entries are higher risk than usual."

**Notification centre:** Alert when danger level crosses 0.75 threshold: "Market environment pattern-matches historical danger period [March 2020 similarity: 81%]"

---

### Phase 7 — Lead-Lag Cross-Asset Graph

**Component added:** `LeadLagPanel`

**Where it appears:** Per-ticker card in TodayPanel, collapsed by default

**Collapsed state:**
```
Lead-Lag: 3 upstream signals active  [+7 NCS] ▾
```

**Expanded state:**
```
Upstream Assets Moving:
  HYG  +1.4%  2d ago  → +5 NCS boost
  XLF  +2.1%  1d ago  → +5 NCS boost
  CPER -0.8%  1d ago  → -3 NCS penalty
Net adjustment: +7 NCS
```

**Visual changes:**
- NCS badge now shows raw + adjusted: "NCS: 67.3 → 74.3 (+7 lead-lag)"
- Adjustment shown in distinct colour (blue for lead-lag, separate from conformal interval)
- If upstream signals are negative: NCS shown with red downward adjustment
- No changes to Auto-Yes/No thresholds — adjustment is factored into displayed NCS only

**Notification centre:** No new alerts (lead-lag is per-scan data, shown in UI only)

---

## Frontier-by-Frontier UI Changes

---

### Frontier 1 — GNN on Lead-Lag Graph

**Component added:** `GNNPropagationBadge`

**Where it appears:** Ticker card, alongside lead-lag panel (these are related — GNN is the smart version of lead-lag)

**Appearance:**
```
GNN: 74  ◉ Network signal strong
```

**Visual changes:**
- Badge with score + connectivity icon
- Green (> 65) / Amber (45–65) / Grey (< 45 or UNVALIDATED)
- Tooltip: "Based on 4 upstream nodes moving over last 2 days — GNN predicts propagation to this ticker"
- UNVALIDATED badge (grey, strikethrough) if weights are > 7 days stale
- Replaces raw lead-lag NCS adjustment display — GNN score is the evolved version

---

### Frontier 2 — Online Bayesian NCS Updating

**Component added:** `LiveNCSTracker`

**Where it appears:** Per-ticker card, visible during trading hours only

**Appearance (stable):**
```
NCS: 72.0 → 72.0  ─  (12 updates)
```

**Appearance (degrading):**
```
NCS: 72.0 → 63.4  ↓  ⚠ Degrading intraday
```

**Visual changes:**
- Prior NCS → Posterior NCS shown with directional arrow
- Update count badge (how many intraday price observations have been incorporated)
- If degraded: amber warning + reclassification indicator ("Auto-Yes → Conditional intraday")
- Resets visually at session start each day (prior resets to morning scan NCS)

**Settings addition:** Toggle in settings: "Show intraday NCS updates" (default ON)

**Notification centre:** Push notification when NCS degrades > 8 points intraday: "NCS degrading: NVDA 72→63 — consider holding entry"

---

### Frontier 3 — Fractional Kelly Sizing

**Component added:** `KellySizingAdvisor`

**Where it appears:** Pre-trade execution confirmation screen (the screen before placing a buy order)

**Appearance (Kelly OFF):**
```
Position size: £340  (2.0% risk)
Kelly Advisor: £272 suggested (0.80×)  [greyed out — Kelly OFF]
```

**Appearance (Kelly ON):**
```
Position size: £340  (2.0% risk)
Kelly Advisor: £272 applied (0.80×)  ✓
  └ Interval: 0.85 · Stress: 0.78 · GNN: 0.77
```

**Visual changes:**
- Advisory row below base position size (always shown, greyed when OFF)
- Breakdown tooltip showing three component scores
- When Kelly ON: size shown as adjusted figure, base shown as strikethrough

**Settings addition:** Toggle: "Apply Kelly multiplier to sizing" (default OFF) — placed in Risk Settings section

---

### Frontier 4 — RL Trade Manager

**Component added:** `RLTradeAdvisor`

**Where it appears:** Open position card (existing positions, not scan candidates)

**Appearance:**
```
RL Advisor: HOLD  ▌▌▌░░  Confidence: 71%
  Last 5: HOLD · HOLD · TRAIL · HOLD · HOLD
```

**Visual changes:**
- Action badge: HOLD (grey) / TIGHTEN (amber) / TRAIL (green) / EXIT EARLY (red)
- Confidence bar (Q-value margin over second-best action)
- Mini timeline of last 5 RL recommendations for this trade
- When EXIT EARLY: red pulsing badge — most prominent visual state

**Settings addition:** Toggle: "RL Shadow Mode" (default ON = advisory only). When OFF: RL TIGHTEN/TRAIL pre-fills the stop update UI for user confirmation.

**Notification centre:** If RL recommends EXIT EARLY with confidence > 80%: push notification "RL advisor recommends early exit: [ticker] — 83% confidence"

---

### Frontier 5 — VPIN

**Component added:** `VPINBadge`

**Where it appears:** Ticker card, in the signal quality section

**Appearance:**
```
VPIN: 81  ↑ Informed Buying
```

**Visual changes:**
- Green badge with upward arrow (INFORMED_BUYING)
- Red badge with warning (INFORMED_SELLING) — also adds -15 NCS adjustment shown on NCS badge
- Grey badge (UNINFORMED / low VPIN)
- No badge shown for NEUTRAL (keeps card uncluttered)
- INFORMED_SELLING is the most visually prominent state — red, bold, shown even when card is collapsed

---

### Frontier 6 — Sentiment Fusion

**Component added:** `SentimentFusionBadge`

**Where it appears:** Ticker card — Conditional trades only (not Auto-Yes or Auto-No)

**Appearance:**
```
Sentiment ↑  News: 68 · Options PCR: 0.54
```

**Visual changes:**
- Only appears on Conditional trade cards (deliberate — sentiment is a tiebreaker, not a primary signal)
- BULLISH: green "Sentiment ↑" with score breakdown on hover
- BEARISH: amber "Sentiment ↓" with warning tone
- MIXED: grey "Mixed signals" — sources disagree
- Low confidence: no badge shown (keeps signal-to-noise high)

---

### Frontier 7 — TDA Regime Detector

**Component added:** `TDARegimeBadge`

**Where it appears:** System status bar in TodayPanel header, alongside Phase 3 signal weights

**Appearance (stable, agrees):**
```
Regime: TRENDING  TDA ✓ Stable
```

**Appearance (early warning):**
```
Regime: TRENDING  TDA ⚡ Transition forming
```

**Visual changes:**
- Small badge next to existing regime indicator
- Green check (STABLE + agrees) / Amber warning (TRANSITIONING) / Red (TURBULENT)
- When transitionWarning=true: amber pulsing badge — distinct from normal amber
- Full-width banner added to TodayPanel when TDA diverges from primary regime:
  "⚡ TDA early warning: topological complexity rising while trend indicators positive. Heightened caution advised."

**Notification centre:** Push when transitionWarning fires: "TDA regime divergence detected — possible early transition signal"

---

### Frontier 8 — Execution Quality Feedback Loop

**New page:** `/execution-quality`

**Navigation:** Added to sidebar under "Performance" section as "Execution Quality"

**Page contents:**
- Summary cards: avg slippage %, best execution window, worst-fill tickers
- Bar chart: average slippage by hour of day
- Line chart: slippage trend over time (improving or deteriorating)
- Table: worst 10 fills (ticker, date, slippage %, context)
- Recommendation panel: "Best window for mid-cap UK: 10:00–11:30 GMT"

**Pre-trade execution screen addition:**
```
Intended risk: 2.0%
Effective risk (avg slippage for this tier): ~2.3%
Best execution window: 10:00–11:30 GMT  [currently: ✓ within window]
```

**No changes to TodayPanel ticker cards.**

---

### Frontier 9 — Unified TradePulse Dashboard

**New page:** `/trade-pulse/[ticker]`

**Entry point:** "Full Analysis →" button added to each Auto-Yes and Conditional ticker card

**Page contents:**
- Hero: large TradePulse score dial (0–100) + grade badge (A+ through D)
- Decision bar: AUTO_YES / CONDITIONAL / AUTO-NO with confidence shading
- Signal grid (3×4): one card per contributing signal, each showing score/status
- Concerns panel: any flagged issues in red/amber
- Opportunity panel: confirming signals in green
- Kelly advisor row: base → suggested size
- RL recommendation badge
- Footer: computation timestamp, next scan time, signal count

**Navigation:** `/trade-pulse` listed in sidebar under "Analysis"

**Visual changes to ticker cards (TodayPanel):**
- "Full Analysis →" link added to bottom of each Conditional/Auto-Yes card
- TradePulse grade badge (A+ / A / B / C / D) shown as a small pill on the card itself
  — so the grade is visible without navigating away

---

## Complete New Page Inventory

| URL | Phase | Description |
|-----|-------|-------------|
| `/signal-audit` | Phase 5 | MI analysis, signal redundancy report |
| `/execution-quality` | Frontier 8 | Slippage analysis, timing recommendations |
| `/trade-pulse/[ticker]` | Frontier 9 | Full unified confidence dashboard per ticker |

---

## Complete New Component Inventory

| Component | Phase | Location |
|-----------|-------|----------|
| `NCSIntervalBadge` | P1 | Ticker card |
| `FailureModePanel` | P2 | Ticker card (expandable) |
| `SignalWeightPanel` | P3 | System status bar |
| `StressTestGauge` | P4 | Ticker card (on-demand) |
| `DangerLevelIndicator` | P6 | Top navigation bar (persistent) |
| `LeadLagPanel` | P7 | Ticker card (expandable) |
| `GNNPropagationBadge` | F1 | Ticker card |
| `LiveNCSTracker` | F2 | Ticker card (trading hours) |
| `KellySizingAdvisor` | F3 | Execution confirmation screen |
| `RLTradeAdvisor` | F4 | Open position card |
| `VPINBadge` | F5 | Ticker card |
| `SentimentFusionBadge` | F6 | Ticker card (Conditional only) |
| `TDARegimeBadge` | F7 | System status bar |
| `TradePulseDashboard` | F9 | `/trade-pulse/[ticker]` page |
| `TradePulseScore` | F9 | Ticker card (grade pill) |

---

## Settings Panel Additions (cumulative)

| Setting | Phase | Default | Location |
|---------|-------|---------|----------|
| Show intraday NCS updates | F2 | ON | Display Settings |
| Apply Kelly multiplier | F3 | OFF | Risk Settings |
| RL Shadow Mode | F4 | ON | Execution Settings |

---

## Notification Centre Additions (cumulative)

| Trigger | Phase | Severity |
|---------|-------|----------|
| NCS calibration completed | P1 | Info |
| Signal weights shifted significantly | P3 | Info |
| Signal audit completed | P5 | Info |
| Danger level crosses 0.75 | P6 | Warning |
| NCS degrading intraday > 8pts | F2 | Warning |
| RL EXIT EARLY > 80% confidence | F4 | Warning |
| TDA regime divergence | F7 | Warning |

---

## Ticker Card: Final State (all phases complete)

A fully-built ticker card for a Conditional candidate will show:

```
┌─────────────────────────────────────────────────────────┐
│  NVDA  NVIDIA Corp                    [B] TradePulse    │
│  ─────────────────────────────────────────────────────  │
│  NCS: 64.2 → 67.1 (+lead-lag)  [57.8 – 70.4]  ██░  │
│  Posterior NCS: 67.1 → 65.3 ↓  (8 updates)           │
│                                                         │
│  VPIN: 74  ↑ Informed Buying    GNN: 68  ◉ Strong     │
│  Sentiment ↑  News: 71 · PCR: 0.58                     │
│                                                         │
│  Failure Modes: ⚠ 1 warn (FM3: Correlation)  [▾]      │
│  Stress Test: 21%  ●●○○○○○○○○  PASS                    │
│                                                         │
│  CONDITIONAL                    Full Analysis →         │
└─────────────────────────────────────────────────────────┘
```

---

## Design Recommendations for F9

Given the density above, F9 (TradePulse Dashboard) should:

1. **Be a relief from the card density** — the full-page dashboard should be calmer and more spacious than the card. Cards are dense by necessity; the dashboard should breathe.

2. **Not duplicate the card** — the grade pill on the card (A/B/C) is enough to communicate quality at a glance. The dashboard is for when the user wants to understand *why*.

3. **Use progressive disclosure** — show the grade + decision at the top, then let the user scroll into the signal breakdown. Don't front-load all 14 signals at once.

4. **Concerns before opportunities** — list what's wrong before what's right. The user needs to know the risks first.

5. **The signal grid should be scannable, not readable** — icon + score + one-word status per signal. Reserve the detail for tooltips and expandable rows.
