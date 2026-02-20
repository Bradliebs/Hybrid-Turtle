# HybridTurtle — Agent Context File
> Read this before touching any file. This system manages real money with real risk rules.

---

## What This System Is

A systematic trading dashboard for momentum trend-following across ~268 tickers (US, UK, European markets). Built to turn discretionary stock trading into a repeatable, risk-first workflow.

- **Stack:** Next.js 14 App Router + React 18 + TypeScript + TailwindCSS + Prisma ORM + SQLite
- **Data:** Yahoo Finance (free, no API key — this is intentional, do not suggest replacing it)
- **Notifications:** Telegram Bot API
- **Broker:** Trading 212
- **Account type:** Small account (SMALL_ACCOUNT risk profile), starting ~£429 + £50/week additions
- **Testing:** Vitest + Zod validation

---

## Weekly Operating Rhythm (Do Not Break This Logic)

| Day | Phase | Rules |
|-----|-------|-------|
| Sunday | PLANNING | Full scan, draft trade plan |
| Monday | OBSERVATION | No trading. Anti-chase guard active |
| Tuesday | EXECUTION | Pre-trade checklist, execute planned trades |
| Wed–Fri | MAINTENANCE | Stop updates, risk monitoring |

The Monday trading block and Tuesday execution window are **behavioural guardrails**, not bugs. Do not remove or soften them.

---

## Architecture — Files That Must Not Be Casually Changed

### 🔴 Sacred Files (changes affect real money — flag before touching)

| File | What It Does | Critical Rule |
|------|-------------|---------------|
| `stop-manager.ts` | Monotonic stop protection | **Stops NEVER decrease. Ever. This is the most important rule in the system.** |
| `position-sizer.ts` | Share calculation | Use `floorShares()` (never `Math.round()` or `Math.ceil()`). Integer brokers floor to whole shares; T212 uses `allowFractional: true` to floor to 0.01 shares. FX conversion applied before sizing. |
| `risk-gates.ts` | 6 hard gates | All 6 must pass. Never short-circuit, bypass, or add a soft override. |
| `regime-detector.ts` | Market environment | Requires 3 consecutive days same regime for BULLISH confirmation. Do not reduce this. |
| `dual-score.ts` | BQS / FWS / NCS scoring | Weights are intentional. Do not rebalance without explicit instruction. |

### 🟡 Important Files (changes have downstream effects — think before editing)

| File | Consumed By |
|------|------------|
| `scan-engine.ts` | `/api/scan/route.ts`, nightly.ts |
| `regime-detector.ts` | risk-gates.ts, scan-engine.ts, nightly.ts |
| `dual-score.ts` | `/api/scan/route.ts`, cross-reference logic |
| `nightly.ts` | Task Scheduler automation — changes affect unattended runs |

---

## The Scan Engine — 7-Stage Pipeline

Do not add, remove, or reorder stages without being asked explicitly.

1. **Universe** — Load active tickers from DB
2. **Technical Filters** — Hard: price > MA200, ADX ≥ 20, +DI > −DI, ATR% cap, data quality. Soft: efficiency < 30 → WATCH
3. **Status Classification** — ≤2% to trigger = READY, ≤3% = WATCH, >3% = FAR
4. **Ranking** — Composite: sleeve priority + status bonus + ADX + volume ratio + efficiency + relative strength
5. **Risk Gates** — All 6 must pass (see risk-gates.ts)
6. **Anti-Chase Guard** — Monday only: blocks if gap > 0.75 ATR or > 3% above trigger
7. **Position Sizing** — `floor(Equity × Risk% / (Entry − Stop) × FX)`

---

## Dual Score System

**BQS (Breakout Quality Score, 0–100)** — Higher is better
- Trend strength, direction dominance, volatility health, proximity to breakout, market tailwind, relative strength, volume

**FWS (Fatal Weakness Score, 0–95 achievable, clamped to 100)** — Higher is WORSE
- Volume risk (max 30) + extension/chasing risk (max 25) + marginal trend (max 10) + vol shock (max 20) + regime instability (max 10) = 95 max achievable in practice

**NCS (Net Composite Score)** = BQS − (0.8 × FWS) + 10, minus earnings/cluster penalties

**Auto-actions:**
- NCS ≥ 70 AND FWS ≤ 30 → Auto-Yes
- FWS > 65 → Auto-No
- Otherwise → Conditional

---

## Risk Profiles

| Profile | Risk/Trade | Max Positions | Max Open Risk |
|---------|-----------|--------------|--------------|
| CONSERVATIVE | 0.75% | 8 | 7.0% |
| BALANCED | 0.95% | 5 | 5.5% |
| **SMALL_ACCOUNT** | **2.00%** | **4** | **10.0%** | ← ACTIVE |
| AGGRESSIVE | 3.00% | 3 | 12.0% |

**Active profile is SMALL_ACCOUNT.** Max 4 positions. This is not a bug.

---

## Stop Manager — Monotonic Ladder

| Level | Triggers At | Stop Moves To |
|-------|------------|--------------|
| INITIAL | Entry | Entry − InitialRisk |
| BREAKEVEN | ≥ 1.5R | Entry price |
| LOCK_08R | ≥ 2.5R | Entry + 0.5 × InitialRisk |
| LOCK_1R_TRAIL | ≥ 3.0R | max(Entry + 1R, Close − 2×ATR) |

**Stops ratchet up only. A function that could lower a stop is a bug, not a feature.**

---

## The 6 Risk Gates (all must pass)

1. **Total Open Risk** — Current + new risk ≤ profile max
2. **Max Positions** — Open count < profile limit
3. **Sleeve Limit** — Sleeve value ≤ cap (CORE 80%, HIGH_RISK 40%)
4. **Cluster Concentration** — ≤ 20% of portfolio (SMALL_ACCOUNT: 25%)
5. **Sector Concentration** — ≤ 25% of portfolio (SMALL_ACCOUNT: 30%)
6. **Position Size Cap** — Per-position value ≤ profile-aware % of portfolio

HEDGE positions excluded from open risk and position counting.

---

## The 21 Modules — Reference Map

| # | Module | File/Location | Touches Risk? |
|---|--------|--------------|--------------|
| 2 | Early Bird | /api/modules/early-bird | Yes — alternative entry logic, on-demand scan from Plan page |
| 3 | Laggard Purge | laggard-detector.ts | No — flags only |
| 5/14 | Climax Detector | /api/modules | No — suggestions only |
| 7 | Heatmap Swap | /api/modules | Yes — cluster caps |
| 8 | Heat Check | /api/modules | Yes — cluster position logic |
| 9 | Fast-Follower | /api/modules | Yes — re-entry logic |
| 10 | Breadth Safety | /api/modules | Yes — caps max positions at 4 |
| 11 | Whipsaw Kill | /api/modules | Yes — blocks re-entry |
| 11b | Adaptive ATR Buffer | /api/modules | Yes — entry buffer scaling |
| 12 | Super-Cluster | /api/modules | Yes — 50% aggregate cap |
| 13 | Momentum Expansion | /api/modules | Yes — expands risk limit |
| 15 | Trade Logger | /api/modules | No — logging only |
| 16 | Turnover Monitor | /api/modules | No — monitoring only |
| 17 | Weekly Action Card | /api/modules | No — reporting only |
| 18 | Data Validator | /api/modules | Indirect — data quality gate |
| 20 | Re-Entry Logic | /api/modules | Yes — re-entry conditions |

> Module numbers are intentionally non-sequential — gaps (1, 4, 6, 19, 21) are reserved or not yet built. The table is complete as-is.

---

## Known Gotchas — Read Before Writing Any Data or Calculation Code

### Yahoo Finance
- Returns **adjusted closes** — dividend-adjusted, not split-only
- UK tickers require `.L` suffix (e.g., `BATS.L`)
- European tickers require exchange suffix (e.g., `.AS`, `.PA`, `.DE`)
- Occasionally returns stale or null data — Module 18 validates but always add null guards
- No SLA — if Yahoo is down, the nightly task must fail gracefully, not crash

### Technical Indicators
- ADX calculation requires **minimum 28 candles** of history — always check data length before calculating
- MA200 requires 200 candles — short-history tickers must be excluded, not defaulted
- ATR spike logic can either soft-cap or hard-block depending on context — check which before modifying

### Database (SQLite + Prisma)
- SQLite has **no native date functions** — use JavaScript Date manipulation, not SQL date queries
- Multi-table writes must use **Prisma transactions** — never write to positions and equity_snapshots independently
- Equity snapshots are **rate-limited to once per 6 hours** — do not remove this guard
- `dev.db` is local only — no cloud sync, no concurrent access assumptions

### Position Sizing
- Always use `floorShares()` on share count — never `Math.round()` or `Math.ceil()`, never raw `Math.floor()`
- FX conversion (GBP↔USD↔EUR) must be applied **before** the sizing formula, not after
- Risk% is per-profile — never hardcode a percentage

### Regime Detector
- ±2% CHOP band around SPY MA200 forces SIDEWAYS regardless of other signals
- Dual benchmark (Module 19) checks both SPY and VWRL — **both** must be bullish for BULLISH confirmation
- 3-day stability requirement is non-negotiable

---

## Nightly Automation — 9-Step Sequence

Runs via `nightly-task.bat` / Task Scheduler. Runs unattended. Failures must be caught and written to DB heartbeat, not allowed to throw unhandled.

1. Health Check (16-point audit)
2. Live Prices (open positions only)
3. Stop Management (R-based recs + auto-apply trailing ATR only)
4. Laggard Detection
5. Risk Modules
6. Equity Snapshot (rate-limited: once per 6 hours)
7. Snapshot Sync (full universe refresh + top 15 READY candidates)
8. Telegram Alert
9. Heartbeat (write success/failure to DB)

**If any step fails: log the error, write FAILED to heartbeat, continue remaining steps where possible. Never let one failed step abort the whole nightly run.**

---

## Coding Standards for This Project

```typescript
// ✅ DO
floorShares(equity * riskPct / rPerShare, allowFractional) // position sizing
// allowFractional: true for Trading 212 (floors to 0.01 shares)
// allowFractional: false (default) for integer-share brokers (floors to whole shares)
await prisma.$transaction([...])            // multi-table writes
if (!data || data.length < 28) return null  // null guards before indicators
ticker.endsWith('.L')                       // UK ticker detection

// ❌ DON'T
Math.round(shares)           // rounding up position sizes
Math.floor(shares)           // use floorShares() instead
any                          // TypeScript any type
// lowering a stop value     // ever, under any circumstance
prisma.positions.update()    // without checking stop monotonicity first
```

- **TypeScript strict mode** — no `any` types
- **Zod** for all external data validation (Yahoo Finance responses especially)
- **Vitest** for tests — add tests for any new calculation logic
- Prefer **surgical edits** over full rewrites
- Add a brief comment on non-obvious trading logic decisions

---

## Dependency Header (add to any file you edit)

```typescript
/**
 * DEPENDENCIES
 * Consumed by: [list files]
 * Consumes: [list files]
 * Risk-sensitive: YES | NO
 * Last modified: [date]
 * Notes: [anything unusual]
 */
```

---

## How to Work With Me on This Project

1. **One task per session** — don't compound tasks
2. **Ask before refactoring** anything outside the stated task scope
3. **Flag explicitly** if a change could affect position sizing, stop logic, or risk gates
4. **List all changed files** at the end of every task
5. **Note any side effects** I should test manually before next nightly run
6. If trading logic is ambiguous — **ask, don't assume**
7. I understand the trading logic deeply. I am not a professional TypeScript developer. **Explain non-obvious code decisions in brief inline comments.**

---

## Pages Reference

| Page | Purpose |
|------|---------|
| `/dashboard` | Health, regime, heartbeat, modules, Fear & Greed |
| `/scan` | 7-stage scan results — READY/WATCH/FAR |
| `/plan` | Weekly execution board + pre-trade checklist + Early Bird scan + CSV export |
| `/portfolio` | Position management, stop updates, R-multiple tracking |
| `/risk` | Risk budget meter, stop panel, trailing stop recommendations |
| `/settings` | Equity, risk profile, Trading 212, Telegram config |
| `/trade-log` | Trade journal with execution quality audit |

---

*Last updated: 20 February 2026*
*Account size: ~£429 + £50/week | Profile: SMALL_ACCOUNT | Broker: Trading 212*
