# HybridTurtle Trading Dashboard v5.11

A systematic trading dashboard built on the Turtle Trading methodology with modern risk management.

---

## Quick Start (Windows)

### First Time Setup

1. **Double-click `install.bat`**
   - It will check for Node.js (and help you install it if missing)
   - Installs all dependencies automatically
   - Sets up the local SQLite database
   - Seeds the stock universe (268 tickers)
   - Creates a desktop shortcut

2. **That's it!** The installer will ask if you want to launch immediately.

### Daily Use

- **Double-click the "HybridTurtle Dashboard" shortcut** on your Desktop
- Or double-click `start.bat` in the project folder
- The dashboard opens at **http://localhost:3000**
- **Keep the black terminal window open** while using the dashboard
- Close the terminal window to stop the server

---

## What Each File Does

| File | Purpose |
|------|---------|
| `install.bat` | One-time setup — installs Node.js deps, database, desktop shortcut |
| `start.bat` | Daily launcher — starts the server and opens your browser |
| `update.bat` | Run after getting new code — updates deps and database |

---

## System Requirements

- **Windows 10 or 11**
- **Node.js 18+** (the installer will help you get this)
- **4 GB RAM** minimum
- **Internet connection** (for live market data from Yahoo Finance)

---

## Features

- **7-Stage Scan Engine** — Systematic screening from 268 stocks
- **Risk Management** — Position sizing, stop-loss tracking, sleeve caps
- **Live Market Data** — Real-time quotes via Yahoo Finance (no API key needed)
- **Portfolio Tracking** — Sync with Trading 212 or manage manually
- **Technical Charts** — Candlestick charts with RSI, MACD, Fibonacci levels
- **Weekly Phase System** — Planning → Observation → Execution → Maintenance

---

## Troubleshooting

### "Node.js not found"
Download and install from https://nodejs.org (choose the LTS version).
After installing, close and re-open the terminal, then try again.

### "npm install failed"
- Try running `install.bat` as Administrator (right-click → Run as administrator)
- Temporarily disable antivirus software
- Make sure you have internet access

### "Port 3000 already in use"
The `start.bat` script handles this automatically. If it persists:
1. Open Task Manager (Ctrl+Shift+Esc)
2. Find any "Node.js" processes
3. End them
4. Try `start.bat` again

### Dashboard shows no data
1. Go to the **Scan** page
2. Click **Run Full Scan** — this fetches live data from Yahoo Finance
3. The first scan may take 2-3 minutes for all 268 tickers

### Need to reset the database
Delete the file `prisma/dev.db` and run `install.bat` again.

---

## For Developers

```bash
# Dev server with hot reload
npm run dev

# Build for production
npm run build && npm start

# Database management
npx prisma studio      # Visual database browser
npx prisma db push     # Apply schema changes
npx prisma db seed     # Re-seed stock universe
```

---

*Built with Next.js 14, Prisma, TailwindCSS, and lightweight-charts.*
