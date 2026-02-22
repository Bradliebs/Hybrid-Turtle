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
