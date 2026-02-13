# HybridTurtle Dashboard — Complete Operating Guide

> **Version:** 5.11 | **Last Updated:** February 2026

---

## Table of Contents

1. [First-Time Setup](#1-first-time-setup)
2. [Settings Screen — Full Walkthrough](#2-settings-screen)
3. [Managing Your Ticker Universe](#3-managing-your-ticker-universe)
4. [Connecting Trading 212](#4-connecting-trading-212)
5. [Dashboard — Your Command Centre](#5-dashboard)
6. [Portfolio — Positions & Distribution](#6-portfolio)
7. [Scan — Finding New Trades](#7-scan)
8. [Plan — Weekly Execution](#8-plan)
9. [Risk — Risk Management](#9-risk)
10. [Nightly Automation](#10-nightly-automation)
11. [The Weekly Workflow](#11-the-weekly-workflow)
12. [All API Routes — Quick Reference](#12-api-routes)
13. [System Rules — Immutable](#13-immutable-rules)
14. [Module System — 21 Risk Checks](#14-module-system)

---

## 1. First-Time Setup

### Step 1 — Install & Start

```bash
cd hybridturtle
npm install                   # Install dependencies
npx prisma generate           # Generate Prisma client
npx prisma db push             # Create database tables
npx prisma db seed             # Import stock universe from Planning/ CSVs
npm run dev                    # Start dashboard at http://localhost:3000
```

Or use the batch files:
- `install.bat` — Full install
- `start.bat` — Start the dashboard
- `run-dashboard.bat` — Alternative starter

### Step 2 — Configure Settings

Navigate to `/settings` and complete each section (see below).

### Step 3 — Connect Trading 212

Enter your API credentials and sync your portfolio (see Section 4).

### Step 4 — Verify Health

Check the Dashboard — the traffic light should be GREEN.

---

## 2. Settings Screen

URL: `/settings`

The Settings page has 6 sections:

### 2.1 Account & Risk Profile

| Field | What It Does |
|-------|-------------|
| **Equity (£)** | Your total account equity. Used for position sizing. Auto-updated if Trading 212 is connected. |
| **Risk Profile** | Controls risk-per-trade % and max positions. |

**Risk Profile Options:**

| Profile | Risk/Trade | Max Positions | Max Open Risk |
|---------|-----------|---------------|---------------|
| Conservative | 0.75% | 8 | 7.0% |
| **Balanced** (default) | **0.95%** | **5** | **5.5%** |
| Small Account | 1.50% | 4 | 10.0% |
| Aggressive | 1.00% | 2 | 6.0% |

**Aggressive Profile Details (Building Mode):**

| Category | Parameter | Value |
|----------|-----------|-------|
| Caps | Mode | BUILDING (2 positions) |
| Caps | Max Position (Core) | 18% |
| Caps | Max Position (High-Risk) | 12% |
| Caps | Max Cluster | 35% |
| Caps | Max Super-Cluster | 50% |
| ADX | Expansion Trigger | ≥ 25 |
| Entry | ATR Buffer | 10% |
| Entry | DIST_READY | ≤ 2.0% |
| Entry | DIST_WATCH | ≤ 3.0% |
| Exit | CHOP Tightening | 1.5×ATR |
| Re-entry | Enabled | Yes |
| Regime | Benchmarks | SPY + SPY |

Click **Save Settings** to persist. This updates the database via `PUT /api/settings`.

### 2.2 Trading 212 Integration

| Field | Purpose |
|-------|---------|
| API Key | Your Trading 212 API key |
| API Secret | Your Trading 212 API secret |
| Environment | `Demo` or `Live` — start with Demo for testing |

- **Connect & Test** — Tests the connection. If successful, stores credentials and shows your account ID + currency.
- **Sync Now** — Imports all T212 positions into the dashboard.
- **Disconnect** — Removes stored credentials.

### 2.3 Data Sources

| Field | Purpose |
|-------|---------|
| Alpha Vantage API Key | Optional backup data source. Get a free key at [alphavantage.co](https://www.alphavantage.co/support/#api-key) |

### 2.4 Telegram Notifications

| Field | Purpose |
|-------|---------|
| Bot Token | Your Telegram bot token (from @BotFather) |
| Chat ID | Your Telegram chat or group ID |
| **Send Test** | Sends a test message to verify the setup |

The nightly cron sends summaries via Telegram including: health status, regime, open positions, stop updates, and alerts.

### 2.5 Ticker Universe Management

This is where you manage which stocks the system scans and monitors. See Section 3 for full details.

### 2.6 Immutable Rules

Read-only list of 10 rules the system enforces. These cannot be changed:

1. Stops NEVER go down
2. No entries without BULLISH regime
3. No entries without health GREEN/YELLOW
4. Risk per trade ≤ profile limit
5. Total open risk ≤ profile cap
6. Position sizing always rounds DOWN
7. No buying on Monday (Observation phase)
8. Anti-chasing guard on gaps
9. Super-cluster cap at 50%
10. Heartbeat must be fresh

---

## 3. Managing Your Ticker Universe

### How Stocks Get Into the System

There are 3 ways:

#### Method 1 — Settings Page (Single Ticker)

1. Go to `/settings` → scroll to **Ticker Universe**
2. Type a ticker (e.g. `NVDA`) in the input box
3. Select a sleeve: **CORE**, **ETF**, **HIGH_RISK**, or **HEDGE**
4. Click **Add**
5. The stock is created in the database via `POST /api/stocks`

#### Method 2 — Seed from Planning Files (Bulk)

The Planning folder contains your stock lists:

| File | Contents |
|------|----------|
| `stock_core_200.txt` | Core sleeve tickers |
| `etf_core.txt` | ETF sleeve tickers |
| `stock_high_risk.txt` | High-risk sleeve tickers |
| `hedge.txt` | Hedge sleeve tickers (long-term holds) |
| `ticker_map.csv` | Ticker → name/sector/cluster mappings |
| `cluster_map.csv` | Ticker → cluster assignments |
| `super_cluster_map.csv` | Ticker → super-cluster groupings |
| `region_map.csv` | Ticker → region + currency |

Run the seed to import them all:

```bash
npx prisma db seed
```

This bulk-upserts all stocks with full metadata (name, sector, cluster, super-cluster, region, currency).

#### Method 3 — Auto-Created from Trading 212

When you sync with Trading 212, any position ticker not already in the database is auto-created with sleeve = `CORE`.

### Removing a Stock

- Click the **X** button next to any stock in the Settings ticker table.
- This performs a soft-delete (sets `active = false`).
- The stock won't appear in scans but historical positions are preserved.
- Hard delete is only possible if the stock has zero positions.

### Searching & Filtering

Use the search box above the ticker table to filter by ticker, name, or sector. Use the sleeve tabs to filter by CORE / ETF / HIGH_RISK / HEDGE.

### Stock Data Fields

| Field | Source | Notes |
|-------|--------|-------|
| Ticker | Manual / seed | Yahoo Finance format (e.g. `AAPL`, `GLEN.L`, `SAP.DE`) |
| Name | Seed / auto | Company name |
| Sleeve | Manual / seed | CORE, ETF, HIGH_RISK, or HEDGE |
| Sector | Seed | e.g. Technology, Healthcare |
| Cluster | Seed / `cluster_map.csv` | e.g. Mega Tech, Energy |
| Super Cluster | Seed / `super_cluster_map.csv` | e.g. MEGA_TECH_AI |
| Region | Seed / `region_map.csv` | e.g. US, UK, EU |
| Currency | Seed / `region_map.csv` | USD, GBP, GBX, EUR, etc. |

---

## 4. Connecting Trading 212

### Initial Connection

1. Go to `/settings` → **Trading 212 Integration**
2. Enter your **API Key** and **API Secret** from Trading 212
3. Select **Demo** or **Live** environment
4. Click **Connect & Test**
5. If successful you'll see your Account ID and Currency

### Syncing Positions

Two places to sync:
- **Settings page** → "Sync Now" button
- **Portfolio → Positions page** → "Sync Positions" button

**What sync does:**
1. Fetches all your T212 positions + account summary
2. Creates new positions in the dashboard DB (with 5% default stop-loss)
3. Updates existing positions (shares / entry price)
4. Marks positions closed on T212 as CLOSED in the dashboard
5. Updates your equity from T212 total account value
6. Updates cash, invested, unrealised P&L figures

**After sync:** The Positions page shows a results card with counts: X new, Y updated, Z closed.

### Disconnecting

Settings page → "Disconnect" button. This removes stored credentials but keeps your synced positions.

---

## 5. Dashboard

URL: `/dashboard`

The dashboard is your daily command centre. Data refreshes automatically every 60 seconds.

### Layout (Top to Bottom)

| Section | What It Shows |
|---------|-------------|
| **⚠️ Red Health Banner** | Full-width red overlay if system health is RED. Must dismiss or investigate. |
| **Market Indices Bar** | Live prices for major indices (S&P 500, Nasdaq, FTSE, etc.) |
| **Weekly Phase** | Current phase: 📋 Think (Sun) → 👁️ Observe (Mon) → ⚡ Act (Tue) → 🔧 Manage (Wed–Fri) |
| **Health Traffic Light** | Overall system health: 🟢 GREEN / 🟡 YELLOW / 🔴 RED |
| **Market Regime** | BULLISH / SIDEWAYS / BEARISH (SPY vs 200-day MA) |
| **Heartbeat Monitor** | Timestamp of last successful nightly run |
| **Quick Actions** | Shortcut buttons to key pages |
| **Risk Modules Widget** | Summary of breadth, momentum, whipsaw, laggard, climax signals |
| **Module Status Panel** | All 21 modules at a glance with status lights |
| **Fear & Greed Gauge** | CNN Fear & Greed Index (0–100, Extreme Fear → Extreme Greed) |
| **Dual Regime Widget** | SPY vs VWRL regime comparison + regime stability indicator |
| **Action Card** | This week's action plan — candidates, stop updates, flags |
| **Recent Alerts** | Latest system events: heartbeats, health checks, trades, stop moves |

---

## 6. Portfolio

### 6.1 Positions Page

URL: `/portfolio/positions`

**KPI Banner (top):** Portfolio Value, Unrealised P&L (with %), Cash, Invested, Open Positions, Last Synced.

**T212 Sync Panel:** Sync button + connection status. After sync shows account summary.

**Positions Table:**

| Column | Description |
|--------|------------|
| Ticker | Stock symbol + name |
| Status | OPEN / CLOSED badge |
| R-Multiple | Current profit in R-units (green/red) |
| Entry | Entry price |
| Current | Live price from Yahoo Finance (GBP-normalised) |
| Stop-Loss | Current stop price (🔒 icon if above initial) |
| Protection | Level: INITIAL → BREAKEVEN → LOCK +0.5R → LOCK +1R TRAIL |
| Shares | Number of shares (fractional to 0.001) |
| Gain % | Unrealised gain/loss percentage |
| Value | Current position value in GBP |
| Risk $ | Current risk in GBP (initialRisk × shares) |
| **Actions** | **Update Stop** and **Exit** buttons (hover to reveal) |

**Update Stop (button):**
- Opens a modal showing position context (entry, current price, current stop, R-multiple)
- **Stop Ladder recommendation table** showing all three levels:

| Level | Trigger | Stop Moves To |
|-------|---------|---------------|
| Breakeven | Profit ≥ +1.5R | Entry Price |
| Partial Lock | Profit ≥ +2.5R | Entry + (0.5 × R) |
| Trail + Lock | Profit ≥ +3.0R | max(Entry + 1R, Close − 2×ATR) |

- Green highlight + ✓ on levels already reached
- **"Use" button** next to each reached level — click to auto-fill the stop price
- Recommendation text below the table
- Monotonic enforcement: new stop MUST be above current stop

**Exit (button):**
- Opens a modal pre-filled with current market price
- Shows entry, shares, current price, P&L
- **Live preview** of realised P&L based on the entered exit price
- Confirm to close the position via `PATCH /api/positions`

### 6.2 Distribution Page

URL: `/portfolio/distribution`

Shows portfolio diversification analysis:

| Section | What It Shows |
|---------|-------------|
| KPI Banner | Portfolio Value, Unrealised P&L, Cash, Equity, Positions |
| Protection Levels | Donut chart: how many positions at each stop level |
| Sleeve Distribution | Donut chart: Core vs ETF vs High-Risk allocation |
| Cluster Concentration | Donut chart: allocation by cluster |
| Sleeve Allocation Bars | Bar chart: used % vs max % per sleeve |
| Performance Chart | Time-series portfolio performance |

---

## 7. Scan — Finding New Trades

URL: `/scan`

The scan runs a 7-stage pipeline against your entire ticker universe. Click **Run Full Scan** to trigger it.

### The 7 Stages

| Stage | Name | What Happens |
|-------|------|-------------|
| 1 | **Universe** | Loads all active stocks grouped by sleeve |
| 2 | **Technical Filters** | Applies 6 technical filters to each ticker: Price > 200-MA, ADX ≥ 20, +DI > −DI, ATR% < 8% (7% for High-Risk), Efficiency ≥ 30%, Data Quality check |
| 3 | **Classification** | Tags each passing candidate: **READY** (≤ 2% from breakout), **WATCH** (≤ 5%), **FAR** (> 5%). Also flags **TRIGGERED** if price is at/above entry trigger |
| 4 | **Ranking** | Scores candidates: Sleeve priority (Core 40, ETF 20, High-Risk 10, Hedge 5) + Status bonus (READY +30, WATCH +10) + ADX + Volume + Efficiency + Relative Strength |
| 5 | **Risk Gates** | Checks: Total open risk ≤ max, positions < max, sleeve within cap, cluster ≤ 20%, sector ≤ 33%, position size cap |
| 6 | **Anti-Chase Guard** | Monday-only: Blocks entries if price gapped > 0.75 ATR or > 3% above the entry trigger |
| 7 | **Position Sizing** | Calculates shares = floor((Equity × Risk%) / ((Entry − Stop) × FX)), fractional to 0.001. Skips if result ≤ 0 |

### Entry Trigger Formula

```
Entry Trigger = 20-day High + (0.10 × ATR(14))
```

### Stop Price (Initial)

```
Initial Stop = Entry Trigger − (1.5 × ATR(14))
```

### The Sidebar

- **Funnel visualisation:** Shows how many candidates survive each stage
- **Position Sizer calculator:** Standalone calculator to manually size a position given entry, stop, and equity

### Bottom Section

- **Ticker Chart:** Click any candidate row to see an interactive price chart with technical indicators

---

## 8. Plan — Weekly Execution

URL: `/plan`

The Plan page is your pre-trade checklist and weekly battle plan. It follows the weekly rhythm:

| Day | Phase | Action |
|-----|-------|--------|
| Sunday | 📋 Think | Review health, run scans, build plan |
| Monday | 👁️ Observe | DO NOT TRADE — watch market reaction |
| Tuesday | ⚡ Act | Execute planned trades |
| Wed–Fri | 🔧 Manage | Monitor positions, update stops |

### Layout (3 Columns)

**Left Column:**
- **Phase Timeline** — Visual timeline showing all 4 phases, highlighting the current one
- **Stop Update Queue** — List of positions with recommended stop adjustments. Shows direction (↑ move up / → hold). Based on R-multiple: ≥ 3R → trail to lock 1R, ≥ 1.5R → breakeven, else hold

**Middle Column:**
- **Ready Candidates** — Positions from the most recent scan classified as READY or WATCH. Quick view of what's actionable.

**Right Column:**
- **Pre-Trade Checklist** — Validation checks before any trade:
  - Health report GREEN/YELLOW?
  - Risk budget available?
  - Regime BULLISH?
  - Not Monday (Observation phase)?
  - Each item shows ✓ pass or ✗ fail

---

## 9. Risk — Risk Management

URL: `/risk`

### Top Banner — Immutable Rules

8 core safety rules displayed in a red panel. These are not configurable — they are hardcoded system constraints.

### Left Column

- **Risk Profile Selector** — Quick-switch between Conservative / Balanced / Small Account / Aggressive. Shows risk/trade % and max positions.
- **Risk Budget Meter** — Visual budget showing:
  - Used risk % vs max risk %
  - Used positions vs max positions
  - Sleeve utilisation: CORE (used/80%), ETF (used/80%), HIGH_RISK (used/40%), HEDGE (used/100%)

### Middle Column

- **Stop-Loss Panel** — All open positions with their stops:
  - Entry price, current stop, gap (how far stop is from current price)
  - Protection level badge (INITIAL → BREAKEVEN → LOCK → TRAIL)
  - Visual progress bar showing stop progression

### Right Column

- **Trailing Stop Panel** — Shows trailing ATR stop recommendations:
  - For each position: highest close since entry, current ATR, calculated trailing stop (Highest Close − 2×ATR)
  - If trailing stop > current stop → recommendation to ratchet up
- **Protection Progress** — Pie/bar chart showing how many positions are at each protection tier

---

## 10. Hedge Portfolio — Long-Term Holds

### What Is the Hedge Sleeve?

The **HEDGE** sleeve is for stocks you want to hold long term — conviction positions that fall outside the normal swing-trading rules. They still receive full system guidance (stop recommendations, protection levels, P&L tracking) but are **exempt** from:

- **Open risk % calculation** — Hedge positions are excluded from the risk budget so they don't block new entries
- **Laggard purge** — No forced-exit flags, even if underwater for weeks
- **Position count limits** — Hedge positions don't count against your max positions
- **Sleeve cap** — Hedge has a 100% cap (effectively unlimited)

### Dashboard Card

The **Hedge Portfolio** card appears on the main dashboard and shows:

| Element | Description |
|---------|-------------|
| Total Value | Combined GBP value of all hedge positions |
| Total P&L | Aggregate profit/loss in £ and % |
| Position Count | Number of active hedge holdings |
| Per-Position Row | Ticker, current price, P&L %, R-multiple |
| Stop Guidance | Current protection level + recommended upgrade if available |
| Near-Stop Alert | Red highlight if price is within 5% of stop |
| Stop Upgrade Badge | Blue "↑ B/E" or "↑ Trail" badge when stop level can be raised |

### How to Add Hedge Positions

1. **Settings → Ticker Universe** — Add a stock with sleeve = **Hedge**
2. **Portfolio → Add Position** — Select **Hedge** from the sleeve dropdown
3. **Planning file** — Add tickers to `hedge.txt` and run `npx prisma db seed`

### Stop Guidance (Not Enforced)

Hedge positions still receive the full stop ladder recommendations:
- **Breakeven** at ≥ 1.5R → stop moves to entry
- **Partial Lock** at ≥ 2.5R → stop moves to entry + 0.5R
- **Trail + Lock** at ≥ 3.0R → stop = max(entry + 1R, close − 2×ATR)

These are shown as guidance badges on the dashboard card. You decide whether to act on them — the system won't auto-apply or flag for forced exit.

### API

`GET /api/positions/hedge?userId=default` — Returns all open hedge positions with live prices, P&L, and stop guidance.

---

## 11. Nightly Automation

### What Runs Automatically

The nightly cron executes at **9:30 PM UK time**, Monday–Friday.

### The 8-Step Nightly Process

| Step | What Happens |
|------|-------------|
| 1 | Run 16-point health check |
| 2 | Fetch all open positions |
| 3 | Generate R-based stop recommendations (breakeven / lock levels) |
| 4 | Generate trailing ATR stop recommendations + **auto-apply** if stop moves up |
| 5 | Collect alerts (health warnings, stop moves, trailing updates) |
| 6 | Fetch user equity |
| 7 | Send Telegram summary with health, regime, positions, stops, alerts |
| 8 | Write heartbeat (SUCCESS or FAILED) |

### Manual Trigger

```bash
npx ts-node src/cron/nightly.ts --run-now
```

Or call the API directly: `POST /api/nightly` with `{"userId": "default-user"}`.

### Health Check — 16 Points

| ID | Check | Category |
|----|-------|----------|
| A1 | Data Freshness (> 2 days warn, > 5 days fail) | Data |
| A2 | Duplicate Tickers | Data |
| A3 | Column Population | Data |
| C1 | Equity > £0 | Risk |
| C2 | Open Risk Within Cap | Risk |
| C3 | Valid Position Sizes | Risk |
| D | Stop Monotonicity | Logic |
| E | State File Currency | Logic |
| F | Config Coherence | Logic |
| G1 | Sleeve Limits | Allocation |
| G2 | Cluster Concentration (≤ 20%) | Allocation |
| G3 | Sector Concentration (≤ 33%) | Allocation |
| H1 | Heartbeat Recent | System |
| H2 | API Connectivity | System |
| H3 | Database Integrity | System |
| H4 | Cron Job Active | System |

---

## 12. The Weekly Workflow

### Sunday — THINK

1. Open Dashboard → check traffic light health
2. Review Fear & Greed, Regime, Dual Benchmark
3. Go to `/scan` → **Run Full Scan**
4. Review READY candidates
5. Go to `/plan` → review pre-trade checklist
6. Build your execution list for Tuesday

### Monday — OBSERVE

1. **DO NOT TRADE**
2. Dashboard → watch market indices, check regime
3. Review any overnight gaps on your READY candidates
4. Anti-chasing guard will block Monday entries anyway

### Tuesday — ACT

1. Go to `/plan` → confirm pre-trade checklist is all-green
2. For each planned trade:
   - Verify the candidate is still READY (check scan)
   - Confirm the entry trigger price
   - Use the position sizer for exact shares
   - Place the trade on Trading 212
3. After trading → Sync positions from T212
4. Verify positions appear correctly in Portfolio

### Wednesday–Friday — MANAGE

1. Dashboard → check daily health + heartbeat
2. Portfolio → review R-multiples on open positions
3. If any position hits a stop-ladder threshold:
   - Click **Update Stop** → use the recommended level
4. Review the Plan page stop-update queue
5. Risk page → check budget utilisation

### Every Night (Automated)

- 9:30 PM: Nightly cron runs health check, updates trailing stops, sends Telegram summary

---

## 13. API Routes — Quick Reference

### Core Data

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/market-data?action=quote&ticker=AAPL` | GET | Single stock quote |
| `GET /api/market-data?action=quotes&tickers=AAPL,MSFT` | GET | Batch quotes |
| `GET /api/market-data?action=prices&tickers=AAPL,MSFT` | GET | Batch prices only |
| `GET /api/market-data?action=indices` | GET | Market indices |
| `GET /api/market-data?action=fear-greed` | GET | CNN Fear & Greed |
| `GET /api/market-data?action=regime` | GET | Market regime (SPY vs 200-MA) |
| `GET /api/market-data?action=historical&ticker=AAPL` | GET | Daily OHLCV bars |

### Settings & Auth

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/settings?userId=X` | GET | Get risk profile + equity |
| `PUT /api/settings` | PUT | Update risk profile + equity |
| `POST /api/auth/register` | POST | Create new user |
| `POST /api/auth/[...nextauth]` | POST | Login (NextAuth) |

### Stock Universe

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/stocks?sleeve=CORE&search=NVD` | GET | List/filter stocks |
| `POST /api/stocks` | POST | Add single: `{ticker, sleeve}` or bulk: `{stocks:[...]}` |
| `DELETE /api/stocks?ticker=AAPL` | DELETE | Soft-delete (active=false) |
| `DELETE /api/stocks?ticker=AAPL&hard=true` | DELETE | Hard-delete (if no positions) |

### Trading 212

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/trading212/connect` | POST | Test + save T212 credentials |
| `DELETE /api/trading212/connect?userId=X` | DELETE | Disconnect T212 |
| `POST /api/trading212/sync` | POST | Full position sync from T212 |
| `GET /api/trading212/sync?userId=X` | GET | Get sync status + account summary |

### Positions & Stops

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/positions?userId=X&status=OPEN` | GET | Get enriched positions (live prices, GBP) |
| `POST /api/positions` | POST | Create manual position |
| `PATCH /api/positions` | PATCH | Close/exit position: `{positionId, exitPrice}` |
| `PUT /api/stops` | PUT | Update stop: `{positionId, newStop, reason}` — **monotonic** |
| `GET /api/stops?userId=X` | GET | Get R-based stop recommendations |
| `GET /api/stops/sync?userId=X` | GET | Get trailing ATR stop recommendations |

### Scan & Plan

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/scan` | POST | Run 7-stage scan: `{userId, riskProfile, equity}` |
| `GET /api/plan?userId=X` | GET | Get weekly phase + execution plan |
| `POST /api/plan` | POST | Create execution plan: `{userId, candidates, notes}` |

### Risk & Health

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/risk?userId=X` | GET | Risk budget + positions |
| `GET /api/health-check?userId=X` | GET | Run 16-point health check |
| `GET /api/heartbeat` | GET | Last heartbeat status |
| `POST /api/heartbeat` | POST | Record new heartbeat |

### Modules & Nightly

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/modules?userId=X` | GET | Run all 21 modules |
| `POST /api/nightly` | POST | Trigger full nightly process |
| `GET /api/portfolio/summary?userId=X` | GET | Portfolio distribution data |
| `GET /api/publications?userId=X` | GET | Recent system events |

### Hedge

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/positions/hedge?userId=X` | GET | Hedge positions with live prices & stop guidance |

---

## 14. Immutable Rules

These are hardcoded into the system and cannot be overridden:

| # | Rule |
|---|------|
| 1 | **Stops NEVER go down** — monotonic enforcement throws error if attempted |
| 2 | **No entries without BULLISH regime** — scan gates block SIDEWAYS/BEARISH |
| 3 | **No entries without GREEN/YELLOW health** — pre-trade checklist enforces |
| 4 | **Risk per trade ≤ profile limit** — position sizer caps at profile % |
| 5 | **Total open risk ≤ profile cap** — risk gate rejects if exceeded |
| 6 | **Position sizing rounds DOWN** — fractional to 0.001, zero-size = skip |
| 7 | **No buying on Monday** — Observation phase, anti-chasing guard active |
| 8 | **Anti-chasing: gap > 0.75 ATR or > 3% blocks entry** — Monday guard |
| 9 | **Super-cluster cap at 50%** — concentration limit per super-cluster |
| 10 | **Heartbeat must be fresh** — data > 2 days = warn, > 5 days = fail |

---

## 15. Module System — 21 Risk & Analysis Checks

All modules run via `GET /api/modules?userId=X` and report to the Dashboard's Module Status Panel.

| # | Module | Status Meaning |
|---|--------|---------------|
| 2 | **Early Bird Entry** | 🟢 = candidates found during bullish regime, 🟡 = none found, 🔴 = wrong regime |
| 3 | **Laggard Purge** | 🟢 = no laggards, 🟡 = laggards flagged (held ≥ 10 days, down ≥ 2%), 🔴 = severe laggards |
| 5 | **Climax Top Exit** | 🟢 = no climax signals, 🟡 = tighten stops, 🔴 = trim recommended |
| 7 | **Heat-Map Swap** | 🟢 = no swaps, 🟡 = swap suggestions available |
| 8 | **Heat Check** | 🟢 = cluster OK, 🔴 = blocked (overweight cluster) |
| 9 | **Fast-Follower Re-Entry** | 🟢 = re-entry signals found, 🟡 = watching cooldowns |
| 9.1 | **Regime Stability** | 🟢 = stable 3+ days, 🟡 = transitioning, 🔴 = chop detected |
| 10 | **Breadth Safety Valve** | 🟢 = breadth healthy (≥ 50%), 🟡 = below threshold, 🔴 = max positions restricted |
| 11 | **Whipsaw Kill Switch** | 🟢 = no blocks, 🔴 = ticker blocked (recent whipsaw) |
| 12 | **Super-Cluster Cap** | 🟢 = within 50% cap, 🔴 = breached |
| 13 | **Momentum Expansion** | 🟢 = ADX high (expanded risk allowed), 🟡 = normal |
| 14 | **Climax Trim/Tighten** | 🟢 = no action, 🟡 = tighten, 🔴 = trim |
| 15 | **Trades Log** | 🟢 = logged OK, includes slippage tracking |
| 16 | **Turnover Monitor** | 🟢 = healthy pace, 🟡 = high turnover (avg hold < 5d or > 20 trades/30d) |
| 17 | **Weekly Action Card** | Generated summary: candidates, stop updates, flags, budget |
| 18 | **Data Validation** | 🟢 = all data fresh, 🟡/🔴 = stale or anomalous tickers |
| 19 | **Dual Benchmark** | SPY + VWRL regime comparison, chop detection |
| 20 | **Re-Entry Logic** | Monitors closed positions for bullish re-entry after cooldown |
| 21 | **Position Tracking** | 🟢 = all positions valid, 🟡/🔴 = mismatches detected |

---

## Quick-Start Checklist

- [ ] Run `npm install` and `npx prisma db push`
- [ ] Seed the stock universe: `npx prisma db seed`
- [ ] Start the dashboard: `npm run dev`
- [ ] Go to `/settings` and set your equity + risk profile
- [ ] Connect Trading 212 (API key + secret)
- [ ] Sync your T212 positions
- [ ] Check Dashboard — traffic light should be GREEN
- [ ] Run your first scan from `/scan`
- [ ] Review the Plan page on Sunday
- [ ] Let the nightly cron handle the rest

---

*Built for the Turtle Way. Systematic. Disciplined. Sleep well.*
