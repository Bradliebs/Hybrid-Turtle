# HybridTurtle User Guide (Complete)

This guide is for everyday users (including non-coders) who want to run HybridTurtle confidently.

---

## 1) What HybridTurtle Does

HybridTurtle is a trading dashboard that helps you:

- track your portfolio and risk in one place
- scan a stock universe for candidates
- follow a weekly trading rhythm (Think → Observe → Act → Manage)
- enforce risk rules automatically (so emotional decisions are reduced)
- update stops using a structured ladder
- run nightly checks and optional Telegram summaries

---

## 2) What You Need Before You Start

- Windows 10/11
- Node.js **20 LTS** or **22 LTS** (LTS tab on nodejs.org)
- Internet connection
- Optional: Trading 212 API credentials (if you want account sync)

---

## 3) First-Time Setup (One-Time)

1. Double-click `install.bat`
2. If Node.js is missing/unsupported, install Node.js 20 or 22 LTS and run `install.bat` again
3. Wait while installer sets up dependencies and database
4. Optional: choose whether to set up nightly Telegram task
5. When complete, use desktop shortcut or `start.bat`

### Launcher Files

- `start.bat` = main launcher for daily use
- `run-dashboard.bat` = compatibility alias that redirects to `start.bat`

---

## 4) Daily Startup

1. Double-click desktop shortcut **HybridTurtle Dashboard** (or run `start.bat`)
2. Wait for browser to open at `http://localhost:3000/dashboard`
3. Keep terminal window open while using the app
4. Close terminal window to stop the dashboard

---

## 5) Main Pages and What To Do There

## Dashboard (`/dashboard`)
Use this as your control center.

Check these first:
- Health traffic light (green/yellow/red)
- Market regime (bullish/sideways/bearish)
- Heartbeat freshness (nightly job health)
- Module panel statuses
- Fear & Greed and dual benchmark context

If a red health banner appears, fix that issue before placing trades.

## Portfolio Positions (`/portfolio/positions`)
Use this to manage open positions.

You can:
- sync positions from Trading 212
- view entry/current/stop, R-multiple, risk, and P&L
- update stops using guided recommendations
- close positions with exit-price preview

## Portfolio Distribution (`/portfolio/distribution`)
Use this to monitor concentration.

You can see:
- sleeve allocation
- cluster concentration
- protection level distribution
- overall portfolio value and trend

## Scan (`/scan`)
Use this to find candidates.

- Click **Run Full Scan**
- Review READY / WATCH / FAR classifications
- Review funnel survival by stage
- Use built-in position sizer for share sizing

## Plan (`/plan`)
Use this as your weekly execution board.

Includes:
- weekly phase timeline
- ready/watch candidate review
- pre-trade checklist
- stop-update queue

## Risk (`/risk`)
Use this to protect the account.

Includes:
- risk profile selector
- risk budget meter
- stop-loss panel
- trailing stop recommendations
- immutable safety rules

## Settings (`/settings`)
Use this for account-level configuration.

Set or verify:
- account equity
- risk profile
- Trading 212 connection details

---

## 6) Weekly Workflow (Recommended)

## Sunday — THINK
- review dashboard health/regime
- run full scan
- review READY candidates
- draft trade plan

## Monday — OBSERVE
- do not trade
- watch market behavior and gaps

## Tuesday — ACT
- confirm plan checklist is green/yellow
- verify candidates are still valid
- size positions and execute
- sync positions after execution

## Wednesday to Friday — MANAGE
- check dashboard health daily
- review stops and update when ladder thresholds are hit
- monitor risk budget and concentration

---

## 7) Core System Rules You Should Know

The platform enforces hard safety constraints, including:

- stops never move down
- no entries on Monday
- anti-chasing blocks excessive gap entries
- position sizing is risk-capped and rounded down
- total risk and concentration caps are enforced
- stale heartbeat/data triggers warnings or failures

Treat these rules as safeguards, not optional suggestions.

---

## 8) Trading 212 Connection and Sync

If you connect Trading 212:

1. Open Settings and save credentials
2. Go to Positions page and run sync
3. Verify portfolio values and open positions after sync

If you disconnect later, stored credentials are removed; synced historical data remains.

---

## 9) Nightly Automation (Optional)

If enabled in installer:
- runs on weeknights (scheduled task)
- executes health checks and stop-related automation
- can send Telegram summary (if token/chat ID are configured)

If PC is off at schedule time, task may run late when machine resumes (depending on task scheduler behavior).

---

## 10) Troubleshooting

## Installer says unsupported Node version
- install Node.js 20 or 22 LTS
- re-run `install.bat`

## `npm install` fails
- close other terminals/apps using project files
- temporarily disable antivirus
- run installer as Administrator
- reboot and retry

## Port 3000 is busy
- close old dashboard windows/terminals
- re-run `start.bat` (it attempts to clear stale process)

## Dashboard opens but no data
- run full scan from Scan page
- verify internet connection
- verify heartbeat and health status

## Trading 212 sync fails
- re-check credentials in Settings
- confirm API access is active
- retry sync from positions page

---

## 11) Update Procedure (When You Receive New Code)

1. Close running dashboard
2. Run `update.bat`
3. Run `start.bat`
4. Check dashboard health and heartbeat after launch

---

## 12) Quick Non-Technical Checklist

- Use `install.bat` once
- Use `start.bat` daily
- Keep terminal open while dashboard is running
- Check health + regime before trading
- Use Scan for candidates, Plan for timing, Risk for limits
- Move stops only upward (the app enforces this)
- Sync positions after trading activity
- Review nightly summaries/alerts regularly

---

## 13) Where to Read More

- `SETUP-README.md` for concise installation help
- `DASHBOARD-GUIDE.md` for deep technical/feature reference

---

Built for systematic, rules-driven execution: consistent process over emotion.