# HybridTurtle Trading Dashboard

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![Node](https://img.shields.io/badge/node-20%20or%2022%20LTS-339933)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748)
![License](https://img.shields.io/badge/license-Private-informational)

Systematic trading workspace built around a Hybrid Turtle process: scan opportunities, enforce risk rules, plan weekly execution, and manage positions with disciplined stop logic.

## Preview

![HybridTurtle Dashboard Preview](docs/preview.svg)

Replace `docs/preview.svg` with a real dashboard screenshot when ready.

## Why this project exists

HybridTurtle helps turn discretionary trading into a repeatable workflow:

- structured weekly cycle: Think → Observe → Act → Manage
- risk-first execution with hard safety constraints
- scan pipeline to rank and filter candidates
- portfolio visibility with stop protection progress
- optional Trading 212 sync and nightly automation

## Core capabilities

- **7-stage scan engine** for candidate discovery and qualification
- **Risk controls** (position sizing, open risk caps, concentration limits)
- **Portfolio management** with stop updates and R-multiple tracking
- **Plan workspace** for pre-trade checks and weekly execution
- **Dashboard command center** with health, regime, heartbeat, and modules
- **Automation hooks** for nightly checks and Telegram notifications

## Quick start (Windows)

### 1) Install (one-time)

1. Install **Node.js 20 or 22 LTS** (choose the LTS tab on nodejs.org).
2. Run `install.bat`.
3. Wait for dependencies + database setup to complete.

### 2) Launch (daily)

- Run `start.bat`.
- Open http://localhost:3000/dashboard.
- Keep the terminal window open while the dashboard is running.

### Launcher files

- `install.bat` — first-time setup
- `start.bat` — primary launcher
- `run-dashboard.bat` — compatibility alias (redirects to `start.bat`)
- `update.bat` — update dependencies/database after pulling new code

## Documentation

- [USER-GUIDE.md](USER-GUIDE.md) — complete end-user guide (non-technical)
- [SETUP-README.md](SETUP-README.md) — concise setup + troubleshooting
- [DASHBOARD-GUIDE.md](DASHBOARD-GUIDE.md) — full feature and operations reference

## Tech stack

- Next.js 14 + React 18
- Prisma + SQLite (local)
- TailwindCSS
- Vitest

## Developer commands

```bash
# Start dev server
npm run dev

# Run lint and unit tests
npm run lint
npm run test:unit

# Prisma workflow
npx prisma generate
npx prisma db push
npx prisma db seed
```

## Notes

- This project is optimized for **Windows desktop workflow**.
- Live data uses Yahoo Finance endpoints in the app.
- Trading 212 integration is optional.
