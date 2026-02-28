# Breakout Probability Score (BPS) — Implementation Plan

**Date:** 28 Feb 2026
**Risk-sensitive:** NO — read-only scoring module, no position sizing/stop/gate changes
**Sacred files touched:** NONE

---

## What BPS Is

A supplementary 0–19 score that estimates the probability of a successful breakout based on 7 factors. Sits **alongside** the existing NCS/BQS/FWS system — does NOT replace it. Higher BPS = more structural evidence for a clean breakout.

---

## 7 Factors (max 19 points total)

| # | Factor | Max Pts | Data Source | Logic |
|---|--------|---------|-------------|-------|
| 1 | Consolidation Quality | 3 | ATR% + close vs MA200 | Tighter = better. ATR% < 2% = 3, < 3% = 2, < 4% = 1 |
| 2 | Volume Accumulation Slope | 3 | Last 20 volume bars (linear regression slope) | Positive slope = accumulation. Steep positive = 3 |
| 3 | RS Rank | 3 | rs_vs_benchmark_pct (already computed) | > 10% = 3, > 5% = 2, > 0% = 1 |
| 4 | Sector Momentum | 2 | Sector ETF 20-day return (cached nightly) | Sector ETF > 0% = 1, > 3% = 2 |
| 5 | Consolidation Duration | 3 | Days price within 5% of 20d high | 10–30 days ideal (3), 5–10 or 30–50 (2), else 1 |
| 6 | Prior Trend Strength | 3 | Weekly ADX (already in SnapshotTicker) | ≥ 30 = 3, ≥ 25 = 2, ≥ 20 = 1 |
| 7 | Failed Breakout History | 2 | failedBreakoutAt in TechnicalData | No recent failed breakout = 2, > 10 days ago = 1, recent = 0 |

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/breakout-probability.ts` | Core algorithm: `calcBPS()`, `linearRegressionSlope()`, `BPSResult` type |
| `src/lib/breakout-probability.test.ts` | Vitest tests for calcBPS + linear regression |
| `src/lib/sector-etf-cache.ts` | In-memory sector ETF momentum cache + nightly refresh function |

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/app/api/scan/cross-ref/route.ts` | Add `bps` field to CrossRefTicker response | None — additive field |
| `src/app/scan/cross-ref/page.tsx` | Show BPS column in cross-ref table | None — display only |
| `src/lib/ready-to-buy.ts` | Add `bps` to CrossRefTicker type, use BPS as tiebreaker in sort | None — display sort only |
| `src/components/portfolio/ReadyToBuyPanel.tsx` | Show BPS badge on candidate cards | None — display only |
| `src/app/api/backtest/route.ts` | Compute and return BPS for each signal hit | None — read-only |
| `src/app/backtest/page.tsx` | Add BPS column to signal table | None — display only |
| `src/cron/nightly.ts` | Add sector ETF cache refresh in Step 5 (non-blocking) | Low — isolated try/catch |

## Implementation Steps

- [x] 1. Explore codebase and understand data flow
- [x] 2. Write this plan
- [ ] 3. Create `src/lib/breakout-probability.ts` with pure calcBPS function
- [ ] 4. Create `src/lib/breakout-probability.test.ts` with Vitest tests
- [ ] 5. Create `src/lib/sector-etf-cache.ts` for nightly sector ETF momentum
- [ ] 6. Wire BPS into cross-ref API route
- [ ] 7. Show BPS on scan cross-ref page
- [ ] 8. Add BPS to ready-to-buy sort + display on portfolio panel
- [ ] 9. Add BPS to backtest API + show on signal replay page
- [ ] 10. Add sector ETF cache refresh to nightly.ts Step 5
- [ ] 11. Verify compilation + run tests

---

# HybridTurtle Optimization Audit — 22 Feb 2026

## Audit Summary

The app is **functionally solid** with good error handling, proper Prisma patterns, and well-structured Zustand state. But there are clear optimization wins — particularly around bundle size and code splitting.

| Area | Status | Notes |
|------|--------|-------|
| Prisma singleton + indexes | ✅ Good | Proper globalThis pattern, good index coverage |
| Error handling in API routes | ✅ Good | Consistent `apiError()` helper everywhere |
| Tailwind config / CSS | ✅ Good | Proper purge paths, dark mode config |
| Tree-shaking imports | ✅ Good | All lucide-react/recharts use named imports |
| TypeScript strict mode | ✅ Good | Enabled in tsconfig |
| Zustand store | ✅ Good | Single lightweight store with 10-min cache |
| No polling (intentional) | ✅ Good | Dashboard checked 1-2x daily, no wasted API calls |
| Code splitting / dynamic imports | ❌ None | recharts (~200KB) + lightweight-charts (~45KB) statically imported |
| Server components | ❌ Underused | Every page/component is `'use client'` — zero SSR |
| HTTP cache headers | ❌ Missing | No API routes return Cache-Control headers |
| React.memo | ❌ Missing | No pure components wrapped in React.memo |
| Index-based keys | ⚠️ Minor | 22 instances of `key={i}` in `.map()` calls |

---

## HIGH Priority — Worth Fixing

### 1. Dynamic Import Heavy Chart Libraries

**Impact:** ~245KB removed from main bundle for non-chart pages.

5 components statically import recharts/lightweight-charts. Every page loads these even when no charts are visible.

**Files to change:**
- `src/components/portfolio/PerformanceChart.tsx` — recharts
- `src/components/portfolio/DistributionDonut.tsx` — recharts
- `src/components/scan/scores/NCSDistributionChart.tsx` — recharts
- `src/components/scan/scores/BQSvsFWSScatter.tsx` — recharts
- `src/components/scan/TickerChart.tsx` — lightweight-charts

**Fix:** Wrap each with `next/dynamic`:
```tsx
import dynamic from 'next/dynamic';
const PerformanceChart = dynamic(() => import('@/components/portfolio/PerformanceChart'), { ssr: false });
```

### 2. Remove Unnecessary `'use client'` from Pure Components

**Impact:** Smaller client bundle, enables server rendering for static UI.

11+ components are `'use client'` but use no hooks, events, or browser APIs:
- `StatusBadge.tsx` — pure render
- `TrafficLight.tsx` — pure render
- `RegimeBadge.tsx` — pure render
- `DualScoreKPICards.tsx` — pure render
- `WhyCard.tsx` — pure render
- `StageFunnel.tsx` — pure render
- `KPIBanner.tsx` — pure render
- `SleeveAllocation.tsx` — pure render
- `ProtectionProgress.tsx` — pure render
- `TechnicalFilterGrid.tsx` — pure render
- `QuickActions.tsx` — only uses `Link`

**Note:** Since parent pages are also `'use client'`, removing these directives alone won't enable SSR. The full benefit comes when parent pages are also converted. But it's still good hygiene.

---

## MEDIUM Priority — Nice to Have

### 3. Add HTTP Cache Headers for Stable Data

API routes that return infrequently-changing data should set cache headers:

```ts
// In route handler:
return NextResponse.json(data, {
  headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' }
});
```

**Candidates:**
- `/api/stocks` — ticker list rarely changes
- `/api/trade-log` — historical data, append-only
- `/api/settings` — user settings change rarely

### 4. Add Missing DB Indexes

```prisma
model Heartbeat {
  @@index([timestamp])  // queried for "latest heartbeat"
}

model SnapshotTicker {
  @@index([snapshotId, ticker])  // composite for common query pattern
}
```

### 5. Prisma `select` Over `include` in API Routes

Several routes use `include: { stock: true }` which fetches all Stock columns when only `ticker` and `currency` are needed. Using `select` reduces data transferred.

**Example fix in positions/route.ts:**
```ts
// Before
include: { stock: true }
// After  
include: { stock: { select: { ticker: true, currency: true, name: true } } }
```

---

## LOW Priority — Marginal Gains

### 6. Fix Index-Based Keys (22 instances)

Replace `key={i}` with stable identifiers where lists can reorder. Most concerning:
- `PositionsTable.tsx` — position data divs
- `ActionCardWidget.tsx` — 9 separate `key={i}` usages
- `PreTradeChecklist.tsx` — checklist items
- `settings/page.tsx` — stock items

### 7. Wrap Pure Components in React.memo

Components like `StatusBadge`, `RegimeBadge`, `KPIBanner` receive same props frequently. Wrapping in `React.memo` prevents wasted re-renders. Low impact since re-render frequency is low (dashboard checked 1-2x daily).

### 8. Clean Up Unused next.config.js

`images.domains: ['avatars.githubusercontent.com']` is configured but no `<img>` or `next/image` is used anywhere. Can be removed for clarity.

---

## NOT Worth Changing

| Item | Why Skip |
|------|----------|
| Add SWR/React Query | Zustand store with 10-min cache is sufficient for 1-2x daily usage |
| Convert all pages to Server Components | Major refactor; single-user dashboard doesn't benefit from SSR |
| Add streaming to /api/scan | Complexity not justified for weekly scan usage |
| Zod in client bundle | Only ~13KB, validation is important |
| Polling/real-time data | Intentionally disabled — dashboard is not a live trading terminal |

---

## Recommended Action Plan

If you want to apply fixes, I'd suggest this order:
1. **Dynamic imports for charts** (biggest bang for buck — ~245KB savings)
2. **Remove unused `images` config** (trivial cleanup)
3. **Add DB indexes** (trivial, prevents future perf issues)
4. **Cache headers on stable API routes** (easy win)
5. **Prisma select optimization** (gradual, route by route)

Want me to implement any of these?
