# HybridTurtle — Complete System Breakdown

> Full architectural reference: every screen, API route, core module, database table, and data flow in the system.

---

## 1. What It Is

A self-hosted systematic trading dashboard for momentum/trend-following across ~268 tickers (US, UK, European markets). It turns discretionary stock trading into a repeatable, risk-first weekly workflow.

- **Account:** ~£429 + £50/week additions via Trading 212 (ISA + Invest)
- **Stack:** Next.js 14 App Router · React 18 · TypeScript strict · TailwindCSS · Prisma ORM · SQLite · Vitest · Zod
- **Data:** Yahoo Finance (free, no API key)
- **Notifications:** Telegram Bot API
- **Broker:** Trading 212 API (dual-account: ISA + Invest)
- **Deployment:** Local Windows machine, single-user, self-hosted

---

## 2. Screens (18 Pages)

### `/dashboard` — Command Centre

**Components:** `MarketIndicesBar`, `QuickActions`, `FearGreedGauge`, `WeeklyPhaseIndicator`, `HealthTrafficLight`, `HeartbeatMonitor`, `DataSourceTile`, `ModuleStatusPanel`, `ActionCardWidget`, `DualRegimeWidget`, `RiskModulesWidget`, `PyramidAlertsWidget`, `HedgeCard`, `ScoringGuideWidget`, `MigrationBanner`, `TodayDirectiveCard`, `OnboardingBanner`

Shows at a glance:

- Market regime (BULLISH / SIDEWAYS / BEARISH / NEUTRAL) with dual-benchmark (SPY + VWRL) status
- Weekly phase indicator (PLANNING → OBSERVATION → EXECUTION → MAINTENANCE)
- 16-point health check traffic light (GREEN / YELLOW / RED)
- Heartbeat monitor (last nightly run status + timestamp)
- Fear & Greed gauge
- All 21 module statuses (climax, breadth, whipsaw, swaps, laggards, etc.)
- Pyramid opportunity alerts
- Hedge position card
- Quick-action buttons (Run Nightly, Run Scan, etc.)

---

### `/scan` — 7-Stage Scan Engine

**Components:** `StageFunnel`, `TechnicalFilterGrid`, `CandidateTable`, `PositionSizer`, `TickerChart` (lazy-loaded)

The main scan page:

- Runs the full 7-stage scan pipeline (Universe → Filters → Status → Rank → Risk Gates → Anti-Chase → Sizing)
- Live funnel visualisation showing how many tickers pass each stage
- Technical filter grid showing ADX, MA200, ATR%, +DI/−DI for each ticker
- Candidate table with READY / WATCH / FAR status badges, rank scores, entry triggers, stop prices, and position size
- Interactive price chart (lightweight-charts) for any selected ticker
- Live price overlay from Yahoo Finance

**Sub-pages:**

- `/scan/scores` — **Dual Score Dashboard:** BQS vs FWS scatter, NCS distribution chart, filterable table of all scored tickers, "Why Card" explaining each score, scoring guide
- `/scan/cross-ref` — **Cross-Reference:** merges scan pipeline results with dual-score system, showing alignment or disagreement between the two scoring angles

---

### `/plan` — Weekly Execution Board

**Components:** `PhaseTimeline`, `ReadyCandidates`, `PreTradeChecklist`, `StopUpdateQueue`, `PositionSizerWidget`, `SwapSuggestionsWidget`, `LaggardAlertsWidget`, `EarlyBirdWidget`, `TodayPanel`

The weekly hub:

- Phase timeline showing current day's phase (Sun=PLANNING, Mon=OBSERVATION, Tue=EXECUTION, Wed–Fri=MAINTENANCE)
- Ready candidates from last scan — sorted and actionable
- Pre-trade checklist (mandatory before buying)
- Stop update queue showing pending stop-raise recommendations
- Position sizer for manual what-if calculations
- Swap suggestions (Module 7: Heatmap Swap)
- Laggard alerts (Module 3)
- Early Bird scanner (Module 2: alternative entry logic, on-demand Yahoo fetch)
- "Today" panel with context-aware actions

---

### `/portfolio/positions` — Position Management

**Components:** `KPIBanner`, `PositionsTable`, `T212SyncPanel`, `PositionSyncButton`, `ReadyToBuyPanel` (lazy), `BreakoutFailurePanel` (lazy), `StopUpdateQueue`

Live position management:

- KPI banner (total value, unrealised P&L, open risk, position count)
- Full positions table with R-multiples, gain%, protection levels, stop prices
- "Ready to Buy" panel with one-click execution flow → `BuyConfirmationModal` → SSE-streamed 4-phase T212 execution
- T212 sync: auto-detect closed positions, sync account types (ISA vs Invest), reset from T212 data
- Breakout failure detection panel
- Per-position actions: close, update stop, reset from T212, journal entry

---

### `/portfolio/distribution` — Portfolio Visualisation

**Components:** `KPIBanner`, `DistributionDonut` (lazy), `PerformanceChart` (lazy), `SleeveAllocation`

Charts and allocation:

- Donut charts by sleeve (CORE / HIGH_RISK / ETF / HEDGE), cluster, and protection level
- Performance curve over time
- Sleeve allocation bars vs limits

---

### `/risk` — Risk Budget & Stops

**Components:** `RiskProfileSelector`, `StopLossPanel`, `TrailingStopPanel`, `ProtectionProgress`, `RiskBudgetMeter`, `CorrelationPanel`

Risk management:

- Risk budget meter (used vs max open risk %)
- Sleeve utilisation breakdown
- Stop-loss panel showing all position stops with R-based protection levels
- Trailing stop recommendations (ATR-based)
- Protection progress bars (INITIAL → BREAKEVEN → LOCK_08R → LOCK_1R_TRAIL)
- Correlation panel showing cross-position correlation flags

---

### `/settings` — Configuration

**Components:** `T212ImportPanel`

- Risk profile selector (CONSERVATIVE / BALANCED / SMALL_ACCOUNT / AGGRESSIVE)
- Equity input (manual update)
- Starting equity override for performance calculations
- Gap Guard configuration (thresholds for weekend/daily ATR gaps)
- Trading 212 credentials (Invest + ISA dual-account)
- T212 trade history CSV import
- Telegram bot token + chat ID with test button
- Market data provider (Yahoo / EODHD)

---

### `/trade-log` — Trade Journal + Audit

**Components:** `RecordPastTradeModal`

- Full trade history table with entry/exit prices, R-multiples, gain/loss, slippage
- Execution quality audit (planned vs actual entry, fill time)
- Decision reasons, tags, lessons learned
- Summary stats: win rate, expectancy, avg slippage
- Regime-based breakdown
- Monthly trend chart
- Manual past-trade recording

---

### `/journal` — Position Journal

- Per-position entry notes with confidence rating (1–5)
- Close notes when exiting
- Lessons learned notes
- Auto-opens via `?position=xxx` query param on position close

---

### `/performance` — Performance Dashboard

- Weeks running, starting equity, current equity, total gain/loss
- Win rate, best/worst trades, average days held
- Equity curve (line chart)
- Exit reason breakdown (stop-loss vs manual sale)
- Open positions with unrealised gain/loss

---

### `/backtest` — Signal Replay

- Historical trigger hit analysis from SnapshotTicker data
- Forward R-multiples and stop ladder simulation
- Read-only, no position creation or DB writes

---

### `/notifications` — Alert Centre

- In-app notifications: trade triggers, stop hits, breakout failures, pyramid adds
- Read/unread status with mark-all-read
- Priority levels and type icons

---

### `/login` & `/register` — Auth

- NextAuth credentials-based authentication
- Email + password login/registration

---

## 3. API Routes (32 Route Groups, 59 Route Files)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/scan` | POST / GET | Run 7-stage scan, cache results, persist to DB |
| `/api/scan/progress` | GET | Polling endpoint for scan progress (stage, count) |
| `/api/scan/scores` | GET | Dual Score (BQS/FWS/NCS) for all tickers |
| `/api/scan/cross-ref` | GET | Merge scan + dual-score for cross-reference view |
| `/api/scan/live-prices` | POST | Live Yahoo quotes for scan candidates |
| `/api/scan/snapshots` | POST / GET | Upload/read master_snapshot CSV data |
| `/api/scan/snapshots/sync` | POST | Full Yahoo Finance data sync → SnapshotTicker rows |
| `/api/positions` | GET / POST | List positions (with live prices, R-multiples) / Create new position (with full risk gate enforcement) |
| `/api/positions/execute` | POST | 4-phase T212 execution: buy → poll fill → set stop → create DB position (SSE streamed) |
| `/api/positions/sync` | POST | Detect closed positions from T212 API |
| `/api/positions/sync-account-types` | POST | Correct ISA vs Invest account types from T212 |
| `/api/positions/hedge` | GET | Hedge sleeve positions with live prices & stop guidance |
| `/api/positions/reset-from-t212` | POST | Overwrite corrupted position data from T212 ground truth |
| `/api/nightly` | POST | HTTP-triggered nightly (same 9-step pipeline as cron) |
| `/api/modules` | GET | All 21 module checks in one call (cached 5 min) |
| `/api/modules/early-bird` | GET | On-demand Early Bird scan (Module 2) |
| `/api/risk` | GET | Risk budget, positions enriched with GBP values, risk efficiency |
| `/api/risk/correlation` | GET | Correlation flags between open positions |
| `/api/risk/correlation-scalar` | POST | Correlation-based position size reducer for buy flow |
| `/api/settings` | GET / PUT | User settings (risk profile, equity, T212, Telegram, Gap Guard) |
| `/api/settings/telegram-test` | POST | Send test Telegram message |
| `/api/health-check` | GET / POST | 16-point health audit |
| `/api/heartbeat` | GET | Latest nightly heartbeat status |
| `/api/stops` | GET / PUT | Stop recommendations and updates |
| `/api/trade-log` | GET / POST | Trade journal CRUD |
| `/api/journal` | GET + sub-routes | Position journal entries |
| `/api/performance/summary` | GET | Performance stats and equity curve |
| `/api/notifications` | GET / PUT | Notification CRUD and read status |
| `/api/stocks` | GET | Stock universe management |
| `/api/trading212` | Various | T212 connection test, position fetch |
| `/api/t212-import` | POST | T212 trade history CSV import |
| `/api/db-status` | GET / POST | Migration status check / Auto-migrate (gated behind `ALLOW_AUTO_MIGRATE` env var) |
| `/api/data-source` | GET | Data provider health |
| `/api/ev-stats` | GET | Expected value statistics |
| `/api/ev-modifiers` | GET | EV modifier lookup |
| `/api/backtest` | GET | Signal replay data |
| `/api/publications` | GET | Publication feed |
| `/api/backup` | GET / POST | Database backup |
| `/api/cache-status` | GET / POST | Cache status check / Clear all caches |
| `/api/dashboard/today-directive` | GET | AI-generated daily trading directive |
| `/api/onboarding` | GET / POST | Onboarding state management |
| `/api/portfolio/summary` | GET | Portfolio summary stats |
| `/api/plan` | GET / POST | Weekly execution plan CRUD |
| `/api/feature-flags` | GET | Feature flag status |
| `/api/stops/apply` | POST | Apply stop recommendations to T212 |
| `/api/stops/sync` | GET / POST / PUT | Sync stops from CSV / T212 |
| `/api/stops/t212` | GET / POST / DELETE / PUT | Direct T212 stop management |

---

## 4. Core Lib Modules (The Brain)

### Sacred Files (affect real money)

| Module | File | What It Does |
|--------|------|-------------|
| **Stop Manager** | `src/lib/stop-manager.ts` | R-based stop ladder (INITIAL → BREAKEVEN → LOCK_08R → LOCK_1R_TRAIL). **Stops NEVER decrease** — monotonic enforcement is the #1 rule. Trailing stop = max(Entry + 1R, Close − 2×ATR) |
| **Position Sizer** | `src/lib/position-sizer.ts` | `Shares = floor(Equity × Risk% / (Entry − Stop) × FX)`. Uses `floorShares()` only (never round/ceil). FX conversion before sizing. Fractional shares for T212 (floor to 0.01) |
| **Risk Gates** | `src/lib/risk-gates.ts` | 6 hard gates, all must pass: (1) Total Open Risk ≤ max, (2) Max Positions, (3) Sleeve Limit, (4) Cluster Concentration ≤ 25%, (5) Sector Concentration ≤ 30%, (6) Position Size Cap. HEDGE excluded from risk counting. Also: `canPyramid()`, `calculatePyramidAddSize()` |
| **Regime Detector** | `src/lib/regime-detector.ts` | Multi-signal scoring: SPY vs MA200, ADX, DI, VIX, A/D breadth. ±2% CHOP band forces SIDEWAYS. 3-day stability requirement. Vol regime detector (LOW/NORMAL/HIGH based on SPY ATR%). Dual benchmark (SPY + VWRL) |
| **Dual Score** | `src/lib/dual-score.ts` | BQS (0–100, higher = better): trend, direction, volatility, proximity, tailwind, RS, volume, weekly ADX, BIS, Hurst. FWS (0–95 achievable): volume risk, extension/chasing, marginal trend, vol shock, regime instability. NCS = BQS − 0.8×FWS + 10 minus penalties. Auto-Yes/No/Conditional |
| **Scan Engine** | `src/lib/scan-engine.ts` | 7-stage pipeline: Universe → Technical Filters → Status Classification → Ranking → Risk Gates → Anti-Chase Guard → Position Sizing |

### Important Support Files

| Module | File | Purpose |
|--------|------|---------|
| **Market Data** | `src/lib/market-data.ts` | Yahoo Finance wrapper: prices, quotes, historical bars, MA, ADX, ATR, efficiency, volume ratio, relative strength. 30-min quote cache. Batch pre-caching |
| **Data Provider** | `src/lib/data-provider.ts` | Resilient fallback chain: Yahoo → AV → EODHD → DB cache. Tracks health (LIVE/STALE/CACHED) |
| **Scan Guards** | `src/lib/scan-guards.ts` | Anti-chase guard (gap > 0.75 ATR or > 3% above trigger → block). Pullback continuation entry detection |
| **Correlation Matrix** | `src/lib/correlation-matrix.ts` | Cross-position correlation computation, stored in DB |
| **Correlation Scalar** | `src/lib/correlation-scalar.ts` | Reduces position size when high correlation with existing holdings |
| **Risk Fields** | `src/lib/risk-fields.ts` | Computes GBP-normalised initial risk, open risk for portfolio aggregation |
| **Equity Snapshot** | `src/lib/equity-snapshot.ts` | Rate-limited (6h) equity recording. Weekly change % calculation |
| **Snapshot Sync** | `src/lib/snapshot-sync.ts` | Full Yahoo data refresh for entire ticker universe → SnapshotTicker DB rows |
| **Laggard Detector** | `src/lib/laggard-detector.ts` | Identifies underperforming positions (dead money) |
| **Breakout Failure** | `src/lib/breakout-failure-detector.ts` | Detects failed breakouts on open positions |
| **Breakout Integrity** | `src/lib/breakout-integrity.ts` | BIS (Breakout Integrity Score 0–15) from latest candle pattern |
| **Breakout Probability** | `src/lib/breakout-probability.ts` | BPS: probabilistic breakout success scoring |
| **Hurst Exponent** | `src/lib/hurst.ts` | Hurst > 0.5 = trending (favourable), < 0.5 = mean-reverting |
| **Earnings Calendar** | `src/lib/earnings-calendar.ts` | Caches next earnings dates, evaluates risk proximity |
| **EV Tracker** | `src/lib/ev-tracker.ts` | Expected Value tracking per trade outcome |
| **EV Modifier** | `src/lib/ev-modifier.ts` | Adjusts EV estimates by regime, ATR bucket, cluster, sleeve |
| **Position Sync** | `src/lib/position-sync.ts` | Detects T212 closures and auto-closes DB positions |
| **Trading 212** | `src/lib/trading212.ts` | T212 REST API client: market buy, stop-loss, position fetch, order polling |
| **Trading 212 Dual** | `src/lib/trading212-dual.ts` | Dual-account (ISA + Invest) wrapper |
| **T212 History Importer** | `src/lib/t212-history-importer.ts` | CSV import of T212 trade history |
| **Telegram** | `src/lib/telegram.ts` | Nightly summary formatter and sender |
| **Alert Service** | `src/lib/alert-service.ts` | In-app notification creation |
| **Health Check** | `src/lib/health-check.ts` | 16-point system audit |
| **Ready-to-Buy** | `src/lib/ready-to-buy.ts` | Identifies actionable candidates from last scan |
| **Sector ETF Cache** | `src/lib/sector-etf-cache.ts` | Sector momentum caching |
| **Signal Translations** | `src/lib/signal-translations.ts` | Human-readable signal explanations |
| **Glossary** | `src/lib/glossary.ts` | Trading term definitions |
| **Nightly Guard** | `src/lib/nightly-guard.ts` | Prevents manual scans while nightly is running |
| **Scan Cache** | `src/lib/scan-cache.ts` | In-memory scan result caching with TTL |

---

## 5. The 21 Modules (Trading Intelligence)

Located in `src/lib/modules/`:

| # | Module | File | Risk? | What It Does |
|---|--------|------|-------|-------------|
| 2 | Early Bird | `early-bird.ts` | Yes | Alternative entry scan during BULLISH regime — finds pre-breakout candidates |
| 3 | Laggard Purge | `laggard-purge.ts` | No | Flags dead-money positions for potential exit |
| 5/14 | Climax Detector | `climax-detector.ts` | No | Detects exhaustion/climax signals (volume + extension) |
| 7 | Heatmap Swap | `heatmap-swap.ts` | Yes | Suggests swapping weak positions for stronger candidates |
| 8 | Heat Check | `heat-check.ts` | Yes | Cluster position logic — prevents overconcentration |
| 9 | Fast Follower | `fast-follower.ts` | Yes | Re-entry after breakout pullback (currently disabled) |
| 10 | Breadth Safety | `breadth-safety.ts` | Yes | Market breadth check — caps max positions at 4 when breadth deteriorates |
| 11 | Whipsaw Guard | `whipsaw-guard.ts` | Yes | Blocks re-entry after recent stop-out |
| 11b | Adaptive ATR Buffer | `adaptive-atr-buffer.ts` | Yes | Dynamically scales entry buffer based on volatility |
| 12 | Super Cluster | `super-cluster.ts` | Yes | 50% aggregate cap on super-cluster exposure |
| 13 | Momentum Expansion | `momentum-expansion.ts` | Yes | Expands risk limit in strong trends (currently disabled) |
| 15 | Trade Logger | `trade-logger.ts` | No | Automated trade log entry creation |
| 16 | Turnover Monitor | `turnover-monitor.ts` | No | Tracks portfolio turnover rate |
| 17 | Weekly Action Card | `weekly-action-card.ts` | No | Generates weekly action summary |
| 18 | Data Validator | `data-validator.ts` | Indirect | Yahoo data quality gate |
| 20 | Re-Entry Logic | `re-entry-logic.ts` | Yes | Conditions for re-entering after exit |

> Module numbers are intentionally non-sequential — gaps (1, 4, 6, 19, 21) are reserved or not yet built.

---

## 6. Nightly Automation (9-Step Pipeline)

Runs via `nightly-task.bat` → `src/cron/nightly.ts` through Windows Task Scheduler. Also triggerable via `/api/nightly` POST.

| Step | What Happens |
|------|-------------|
| **0** | Pre-cache historical data for all ~268 tickers (warm Yahoo cache) |
| **1** | 16-point health check (DB, data freshness, positions, stops, etc.) |
| **2** | Fetch live prices for open positions (Yahoo → AV → EODHD → DB fallback chain) + FX normalisation to GBP |
| **3** | Generate R-based stop recommendations. Auto-apply trailing ATR stops for LOCK_1R_TRAIL positions only |
| **4** | Detect laggards (underperformers) + breakout failures |
| **5** | Run risk modules: climax, swap suggestions, whipsaw blocks, breadth safety, correlation matrix, sector momentum, earnings cache |
| **6** | Record equity snapshot (rate-limited 6h). Check pyramid opportunities for positions ≥ 2R |
| **7** | Full universe snapshot sync (Yahoo → DB) + query top 15 READY candidates + trigger-met detection |
| **8** | Send Telegram summary with: positions, stops, ready candidates, triggers met, laggards, climax, swaps, breadth, pyramids, gap risks, breakout failures, data source health |
| **9** | Write heartbeat to DB (SUCCESS or FAILED with error details) |

**Failure handling:** Each step wraps in try/catch. Failures log, set `hadFailure = true`, and continue remaining steps. Final heartbeat records partial failure. All inner catch blocks include `console.warn` logging (no silent suppression).

There is also a `midday-sync.ts` (`midday-sync-task.bat`) for mid-day position sync against T212. It writes a `SKIPPED` heartbeat when exiting early (weekend or zero open positions) so the dashboard can distinguish a skip from a silent crash.

---

## 7. Database Schema (SQLite + Prisma)

**21 tables** defined in `prisma/schema.prisma`:

| Table | Purpose |
|-------|---------|
| `User` | Settings, equity, risk profile, T212 credentials (Invest + ISA), Telegram, Gap Guard config |
| `Stock` | Ticker universe (~268 rows): ticker, name, sleeve, sector, cluster, region, currency, T212 mapping, ISA eligibility |
| `Position` | Open/closed positions: entry/exit prices, stops, R-multiples, protection level, T212 ticker, account type (ISA/Invest) |
| `StopHistory` | Audit trail of every stop change (old → new, level, reason) |
| `Scan` | Scan run metadata (date, regime) |
| `ScanResult` | Per-ticker scan results (technicals, status, rank, gates, sizing) |
| `ExecutionPlan` | Weekly execution plan storage |
| `HealthCheck` | Health check results (overall, individual check details) |
| `Heartbeat` | Nightly run status (RUNNING / SUCCESS / FAILED) |
| `TradeLog` | Full trade journal: entry/exit, R-multiples, slippage, lessons, tags, T212 import fields |
| `TradeTag` | Tag taxonomy for trade categorisation |
| `EquitySnapshot` | Periodic equity recordings with open-risk % |
| `RegimeHistory` | Historical regime readings (SPY + VWRL benchmark data) |
| `Snapshot` / `SnapshotTicker` | Full universe technical data snapshots (close, ATR, ADX, DI, vol, breadth, regime, BIS, Hurst, etc.) |
| `EvRecord` | Expected value tracking per closed trade (regime, ATR bucket, cluster, sleeve, outcome, R-multiple) |
| `CorrelationFlag` | Pairwise ticker correlation data |
| `ExecutionLog` | T212 API call audit trail (request/response, phase, errors) |
| `Notification` | In-app alerts with type, priority, read status |
| `EarningsCache` | Cached next-earnings dates per ticker |
| `TradeJournal` | Per-position entry/close/learned notes with confidence ratings |

---

## 8. Data Flow Summary

```
Yahoo Finance (free, no API key)
    ↓
market-data.ts (fetch, cache 30 min, compute ATR/ADX/MA/RS)
    ↓
┌─── scan-engine.ts (7-stage pipeline) ──→ /scan page
│       Stage 1: Universe (DB stocks)
│       Stage 2: Technical Filters (MA200, ADX≥20, +DI>−DI, ATR cap)
│       Stage 3: Status (READY ≤2%, WATCH ≤3%, FAR >3%)
│       Stage 4: Ranking (composite score)
│       Stage 5: Risk Gates (6 hard gates)
│       Stage 6: Anti-Chase Guard
│       Stage 7: Position Sizing (floorShares)
│
├─── dual-score.ts (BQS/FWS/NCS scoring) ──→ /scan/scores, /scan/cross-ref
│
├─── snapshot-sync.ts (full universe refresh) ──→ SnapshotTicker DB
│
├─── risk-gates.ts ──→ Position creation gate enforcement
│
├─── stop-manager.ts ──→ Monotonic stop ladder ──→ T212 stop-loss API
│
├─── position-sizer.ts ──→ Share calculation ──→ T212 buy order
│
└─── regime-detector.ts ──→ Dashboard regime badge, entry blocking

Trading 212 API
    ↕
trading212.ts / trading212-dual.ts
    ↓
positions/execute (buy → poll → stop → DB) ←→ BuyConfirmationModal
positions/sync (detect closures) ←→ PositionSyncButton

Telegram Bot API
    ←
telegram.ts (nightly summary, alerts)
```

---

## 9. Weekly Workflow (enforced by code)

| Day | Phase | What The System Does |
|-----|-------|---------------------|
| **Sunday** | PLANNING | Full scan available. Dual scores refresh. Draft trade plan. Review Early Bird candidates |
| **Monday** | OBSERVATION | **New entries blocked.** Anti-chase guard active. Observe market, no trading. Nightly runs normally |
| **Tuesday** | EXECUTION | Pre-trade checklist enforced. Execute planned trades via Buy Confirmation Modal → T212. Risk gates checked at execution time |
| **Wednesday–Friday** | MAINTENANCE | Stop updates, risk monitoring, laggard detection, equity snapshots. No new scan urgency |

---

## 10. Risk Profiles

| Profile | Risk/Trade | Max Positions | Max Open Risk | Status |
|---------|-----------|--------------|---------------|--------|
| CONSERVATIVE | 0.75% | 8 | 7.0% | Available |
| BALANCED | 0.95% | 5 | 5.5% | Available |
| **SMALL_ACCOUNT** | **2.00%** | **4** | **10.0%** | **ACTIVE** |
| AGGRESSIVE | 3.00% | 3 | 12.0% | Available |

---

## 11. Stop Manager — Monotonic Ladder

| Level | Triggers At | Stop Moves To |
|-------|------------|--------------|
| INITIAL | Entry | Entry − InitialRisk |
| BREAKEVEN | ≥ 1.5R | Entry price |
| LOCK_08R | ≥ 2.5R | Entry + 0.5 × InitialRisk |
| LOCK_1R_TRAIL | ≥ 3.0R | max(Entry + 1R, Close − 2×ATR) |

**Stops ratchet up only. A function that could lower a stop is a bug, not a feature.**

---

## 12. The 6 Risk Gates (all must pass)

1. **Total Open Risk** — Current + new risk ≤ profile max (HEDGE excluded)
2. **Max Positions** — Open count < profile limit (HEDGE excluded)
3. **Sleeve Limit** — Sleeve value ≤ cap (CORE 80%, HIGH_RISK 40%)
4. **Cluster Concentration** — ≤ 20% of portfolio (SMALL_ACCOUNT: 25%)
5. **Sector Concentration** — ≤ 25% of portfolio (SMALL_ACCOUNT: 30%)
6. **Position Size Cap** — Per-position value ≤ profile-aware % of portfolio

---

## 13. Dual Score System

### BQS (Breakout Quality Score, 0–100) — Higher is better

Components: trend strength, direction dominance, volatility health, proximity to breakout, market tailwind, relative strength, volume, weekly ADX, BIS (Breakout Integrity Score), Hurst exponent.

### FWS (Fatal Weakness Score, 0–95 achievable, clamped to 100) — Higher is WORSE

Components: volume risk (max 30) + extension/chasing risk (max 25) + marginal trend (max 10) + vol shock (max 20) + regime instability (max 10) = 95 max achievable in practice.

### NCS (Net Composite Score)

`NCS = BQS − (0.8 × FWS) + 10`, minus earnings/cluster penalties.

### Auto-actions

- NCS ≥ 70 AND FWS ≤ 30 → **Auto-Yes**
- FWS > 65 → **Auto-No**
- Otherwise → **Conditional**

---

## 14. State Management

- **Server:** Prisma ORM → SQLite (`dev.db`). All truth lives in the database
- **Client:** Zustand store (`src/store/useStore.ts`) for ephemeral UI state (equity, risk profile, selected items)
- **Caching:** In-memory caches with TTL: scan results, module results (5 min), Yahoo quotes (30 min), scan progress. Scan and module caches are **auto-invalidated** when positions are created or closed
- **API:** RESTful JSON, Zod-validated requests, standardised error responses via `apiError()`
- **Auth:** Lightweight NextAuth JWT middleware (`src/middleware.ts`) protects all `/api/*` routes except `/api/auth/*` and `/api/health`
- **Error Boundaries:** React `error.tsx` files at root and key route segments (dashboard, scan, positions, distribution, risk) catch runtime exceptions and show recovery UI

---

## 15. Shared Components

| Component | Purpose |
|-----------|---------|
| `Navbar` | Top navigation across all pages |
| `RegimeBadge` | Colour-coded regime indicator (BULLISH=green, SIDEWAYS/NEUTRAL=amber, BEARISH=red) |
| `StatusBadge` | READY/WATCH/FAR status pills |
| `TrafficLight` | Green/yellow/red health indicator |
| `LiveDataBootstrap` | Root-level component that hydrates client store on app load |
| `GlossaryTerm` | Hover-tooltip for trading terms |

---

## 16. Testing

- **Framework:** Vitest
- **Test files:** Co-located with source (`.test.ts` alongside `.ts`)
- **Coverage areas:** Position sizer, risk gates, stop manager, dual score, scan guards, regime detector, correlation scalar, breakout probability, risk fields, hurst exponent, EV modifier, laggard detector, breakout failure detector, breakout integrity, adaptive ATR buffer, scan pass flags, scan DB reconstruction, trading 212 dual, market data trigger window
- **Validation:** Zod schemas on every API endpoint and external data source

---

## 17. Deployment & Scripts

| Script | Purpose |
|--------|---------|
| `start.bat` | `prisma migrate deploy` → `next dev` |
| `install.bat` | `npm install` → `prisma generate` → `prisma migrate deploy` → seed |
| `update.bat` | Pull latest → install → migrate |
| `nightly-task.bat` | Windows Task Scheduler → `npx tsx src/cron/nightly.ts --run-now` |
| `midday-sync-task.bat` | Scheduled midday data refresh |
| `register-nightly-task.bat` | Create Windows scheduled task for nightly automation |
| `register-midday-sync.bat` | Create Windows scheduled task for midday sync |
| `seed-tickers.bat` | Seed stock universe into DB |
| `run-dashboard.bat` | Start dashboard only |
| `package-for-distribution.bat` | Package for deployment to another machine |

No cloud deployment — fully self-hosted, single-user, local Windows machine.

---

## 18. File Structure Overview

```
prisma/
  schema.prisma          — 21-table SQLite schema
  seed.ts                — Stock universe seeder
  migrations/            — Prisma migration history

src/
  middleware.ts          — API auth middleware (NextAuth JWT, protects /api/*)
  app/
    page.tsx             — Root redirect → /dashboard
    layout.tsx           — Root layout (dark theme, Inter font, LiveDataBootstrap)
    error.tsx             — Root error boundary (recovery UI)
    dashboard/page.tsx   — Command centre
    dashboard/error.tsx  — Dashboard error boundary
    scan/page.tsx        — 7-stage scan
    scan/error.tsx       — Scan error boundary
    scan/scores/page.tsx — Dual score dashboard
    scan/cross-ref/      — Cross-reference view
    plan/page.tsx        — Weekly execution board
    portfolio/positions/ — Position management
    portfolio/positions/error.tsx — Positions error boundary
    portfolio/distribution/ — Charts & allocation
    portfolio/distribution/error.tsx — Distribution error boundary
    risk/page.tsx        — Risk budget & stops
    risk/error.tsx       — Risk error boundary
    settings/page.tsx    — Configuration
    trade-log/page.tsx   — Trade journal
    journal/page.tsx     — Position journal
    performance/page.tsx — Performance dashboard
    backtest/page.tsx    — Signal replay
    notifications/page.tsx — Alert centre
    login/page.tsx       — Login
    register/page.tsx    — Registration
    api/                 — 32 route groups, 59 route files (see Section 3)

  lib/
    stop-manager.ts      — Monotonic stop ladder (SACRED)
    position-sizer.ts    — Share calculation (SACRED)
    risk-gates.ts        — 6 hard gates (SACRED)
    regime-detector.ts   — Market regime (SACRED)
    dual-score.ts        — BQS/FWS/NCS (SACRED)
    scan-engine.ts       — 7-stage pipeline (SACRED)
    market-data.ts       — Yahoo Finance wrapper
    ...                  — 40+ support modules (see Section 4)
    modules/             — 18 trading intelligence modules (see Section 5)

  components/
    shared/              — Navbar, RegimeBadge, StatusBadge, etc.
    dashboard/           — 15 dashboard widgets
    scan/                — Scan components + scores/ sub-folder
    plan/                — 9 plan widgets
    portfolio/           — 11 portfolio components
    risk/                — 6 risk components
    settings/            — T212ImportPanel
    trade-log/           — RecordPastTradeModal

  cron/
    nightly.ts           — Standalone nightly automation (9 steps)
    midday-sync.ts       — Mid-day data refresh

  store/
    useStore.ts          — Zustand client state

  types/
    index.ts             — All TypeScript types, risk profiles, constants
```

---

*Last updated: 4 March 2026*
