# HybridTurtle API Routes & Nightly Automation Audit
**Date:** 2026-02-23  
**Scope:** All 30 API route files + nightly.ts + api/nightly/route.ts parity  
**Status:** System manages real money — findings ranked by risk severity  

---

## Executive Summary

| Category | Status |
|----------|--------|
| Error handling / try-catch | ✅ All routes wrapped |
| `apiError()` helper usage | ✅ Consistent everywhere |
| Prisma transactions for multi-table writes | ✅ Used correctly |
| `any` type usage | ✅ None found |
| Null guards on external data | ✅ Good coverage |
| `Math.round`/`Math.ceil` on share counts | ✅ None found |
| Stop monotonic violations | ✅ All paths use `updateStopLoss()` which enforces monotonic |
| Nightly 9-step sequence | ✅ All steps present in both files |
| Nightly failure isolation | ✅ Each step wrapped in try-catch |
| Heartbeat always writes | ✅ Both success and outer catch write heartbeat |
| **Nightly parity drift** | **🔴 3 differences found** |
| **Unvalidated `request.json()` calls** | **🟡 3 routes** |
| **`as unknown as` type casts** | **🟡 6 instances** |

---

## TASK 1: API Route Audit (30 routes)

### 🔴 Critical Findings

#### 1. `settings/route.ts` PUT — Unvalidated `request.json()` (Line 74)

```typescript
const { userId, riskProfile, equity, marketDataProvider, eodhApiKey } = await request.json();
```

This route **destructures raw JSON without Zod validation**, unlike every other mutation route. If `equity` is a string or negative, it gets passed directly to `prisma.user.update()`. The `riskProfile` has a manual `includes()` check, but `equity` and `eodhApiKey` have no type validation.

**Risk:** Corrupt equity value → wrong position sizing → real money impact.  
**Fix:** Add `parseJsonBody(request, settingsUpdateSchema)` with a Zod schema, matching the pattern used in all other routes.

#### 2. `scan/snapshots/route.ts` DELETE — Unvalidated `request.json()` (Line 220)

```typescript
const { id } = await request.json();
```

No Zod validation, no null guard on `id`, no try-catch on the `request.json()` call. If the body is invalid JSON, this will throw an unhandled error.

**Risk:** Low (delete operation, not money-affecting). But breaks the project's own consistency standard.

#### 3. `stops/t212/route.ts` DELETE — Loose JSON fallback (Line 290)

```typescript
const body = await request.json().catch(() => ({}));
positionId = body.positionId;
```

Falls back to empty object `{}`, then `body.positionId` is `undefined`. There IS a null check below, so this is functionally safe, but the `body` has no type narrowing.

---

### 🟡 Medium Findings

#### 4. `modules/route.ts` — Unsafe Prisma type casts (Lines 258, 268)

```typescript
const rh = await (prisma as unknown as Record<string, { findMany: ... }>).regimeHistory?.findMany({ ... });
return await (prisma as unknown as Record<string, { count: ... }>).tradeLog?.count({ ... });
```

These cast `prisma` to `unknown` then to a dynamic record type to access `regimeHistory` and `tradeLog`. If these models don't exist in the schema, this silently returns `undefined` (handled with `?`). But it's a code smell — should use proper Prisma model access.

**Risk:** If schema changes, these silently stop working with no compile-time error.

#### 5. `scan/scores/route.ts` and `scan/cross-ref/route.ts` — `as unknown as Record` casts

Six instances across these two files where Prisma DB rows are cast to `Record<string, unknown>` to feed into `dbRowToSnapshotRow()`. This is because the Prisma type doesn't match the manual mapping function's expected shape.

**Risk:** Type safety gap. If DB schema changes, these mappings silently produce wrong values.

#### 6. Nightly API route — Breadth uses FULL universe (Line 343 vs nightly.ts Line 357)

```typescript
// api/nightly/route.ts — ALL tickers (potentially 266 Yahoo calls)
const breadthPct = universeTickers.length > 0 ? await calculateBreadth(universeTickers) : 100;

// nightly.ts — 30-ticker sample (intentional optimization)
const sampleSize = Math.min(30, universeTickers.length);
const shuffled = [...universeTickers].sort(() => Math.random() - 0.5);
const breadthSample = shuffled.slice(0, sampleSize);
```

The API route makes ~266 sequential Yahoo calls for breadth. The cron version intentionally samples 30 to avoid this.

**Risk:** API route may timeout or get rate-limited by Yahoo. Breadth result is the same statistically but the API route is much slower.

#### 7. `settings/route.ts` PUT — `data` object uses `Record<string, unknown>` (Line 89)

```typescript
const data: Record<string, unknown> = {};
```

This bypasses TypeScript's type checking for the Prisma update. If a field name is misspelled, it won't cause a compile error.

---

### 🟢 Clean Routes (no issues found)

| Route | Methods | Notes |
|-------|---------|-------|
| `auth/[...nextauth]/route.ts` | GET, POST | Thin wrapper around NextAuth |
| `auth/register/route.ts` | POST | Zod validated, bcrypt hashing, `apiError()` |
| `health-check/route.ts` | GET, POST | Both methods validated, `apiError()` |
| `heartbeat/route.ts` | GET, POST | Simple CRUD, `apiError()` |
| `market-data/route.ts` | GET | Switch-based routing, all branches guarded |
| `modules/early-bird/route.ts` | GET | Cache + regime guard, `apiError()` |
| `plan/route.ts` | GET, POST | Zod validated, `apiError()` |
| `positions/route.ts` | GET, POST, PATCH | Zod validated, `$transaction` for multi-table, risk gates enforced, `apiError()` |
| `positions/hedge/route.ts` | GET | Live prices + GBP normalization, `apiError()` |
| `portfolio/summary/route.ts` | GET | GBP normalization, `apiError()` |
| `publications/route.ts` | GET | Simple DB reads, `apiError()` |
| `risk/route.ts` | GET | Full risk budget with GBP normalization |
| `scan/route.ts` | GET, POST | Zod validated, DB persistence, `apiError()` |
| `scan/live-prices/route.ts` | POST | Zod validated, `apiError()` |
| `scan/snapshots/sync/route.ts` | POST | Thin wrapper around `syncSnapshot()` |
| `stops/route.ts` | GET, PUT | Zod validated on PUT, merged R-based + trailing, monotonic enforced |
| `stops/sync/route.ts` | GET, POST, PUT | CSV import + trailing stops, monotonic enforced |
| `stops/t212/route.ts` | GET, POST, DELETE, PUT | Multi-account routing, monotonic enforced |
| `stocks/route.ts` | GET, POST, DELETE | Zod validated, `$transaction` for bulk, `apiError()` |
| `trade-log/route.ts` | GET | Filtered query, `apiError()` |
| `trade-log/summary/route.ts` | GET | Statistical aggregation, `apiError()` |
| `trading212/connect/route.ts` | POST, DELETE | Zod validated, `$transaction` on disconnect |
| `trading212/sync/route.ts` | GET, POST | `$transaction` per position, risk gates validated post-sync |
| `settings/telegram-test/route.ts` | POST | Zod validated, `apiError()` |

---

### Math.round/Math.ceil Usage

3 instances found — **all on scores/percentages, NONE on share counts**:

| File | Line | Usage | Verdict |
|------|------|-------|---------|
| `scan/scores/route.ts` | L101 | `Math.round(avg * 10) / 10` | ✅ Score rounding, not shares |
| `scan/cross-ref/route.ts` | L307 | `Math.round(agreementScore)` | ✅ Agreement score, not shares |
| `scan/cross-ref/route.ts` | L344 | `Math.round(distancePct * 100) / 100` | ✅ Percentage, not shares |

---

### Stop Monotonic Enforcement

All stop update paths route through `updateStopLoss()` in `stop-manager.ts`, which enforces:
```typescript
if (newStop < position.currentStop) {
  throw new StopLossError(`Cannot lower stop...`);
}
```

Routes that call `updateStopLoss`: stops/route.ts, stops/sync/route.ts, stops/t212/route.ts, nightly/route.ts, nightly.ts — **all protected**.

---

## TASK 2: Nightly Automation Audit

### 9-Step Verification

| Step | nightly.ts | api/nightly/route.ts | Parity |
|------|-----------|---------------------|--------|
| 0. Pre-cache data | ✅ Lines 58-66 | ❌ **Missing** | 🔴 DRIFT |
| 1. Health Check | ✅ Lines 69-79 | ✅ Lines 63-71 | ✅ |
| 2. Live Prices | ✅ Lines 82-121 | ✅ Lines 74-110 | ✅ |
| 3. Stop Management (R-based) | ✅ Lines 124-171 | ✅ Lines 113-166 | ✅ |
| 3b. Trailing ATR stops | ✅ Lines 174-194 | ✅ Lines 169-189 | ✅ |
| 4. Laggard Detection | ✅ Lines 197-241 | ✅ Lines 203-243 | ✅ |
| 5. Risk Modules | ✅ Lines 244-420 | ✅ Lines 246-394 | 🟡 See below |
| 6. Equity Snapshot | ✅ Lines 423-438 | ✅ Lines 397-412 | ✅ |
| 6b. Pyramid checks | ✅ Lines 440-487 | ✅ Lines 415-468 | ✅ |
| 7. Snapshot Sync | ✅ Lines 500-592 | ✅ Lines 472-553 | ✅ |
| 8. Telegram Summary | ✅ Lines 596-644 | ✅ Lines 556-599 | ✅ |
| 9. Heartbeat | ✅ Lines 647-663 | ✅ Lines 602-616 | ✅ |

### 🔴 Parity Drift Findings

#### DRIFT 1: Pre-cache step missing from API route

`nightly.ts` has a Step 0 that pre-caches historical data for all active tickers:
```typescript
// nightly.ts L58-66
const preCacheResult = await preCacheHistoricalData();
```

The API route `api/nightly/route.ts` does NOT have this step. This means the API route makes more individual Yahoo calls downstream (for ATR calculations in steps 3, 6b) without the benefit of a warm cache.

**Risk:** API route is slower and more susceptible to Yahoo rate-limiting. Not a correctness issue.

#### DRIFT 2: Breadth calculation — full universe vs 30-ticker sample

`nightly.ts` uses a 30-ticker random sample for breadth (Lines 357-360):
```typescript
const sampleSize = Math.min(30, universeTickers.length);
const shuffled = [...universeTickers].sort(() => Math.random() - 0.5);
const breadthSample = shuffled.slice(0, sampleSize);
```

`api/nightly/route.ts` uses the FULL universe (~266 tickers) (Line 343):
```typescript
const breadthPct = universeTickers.length > 0 ? await calculateBreadth(universeTickers) : 100;
```

**Risk:** API route is ~9x slower for breadth. Could timeout. Statistically equivalent accuracy.

#### DRIFT 3: Module error isolation differs

In `nightly.ts`, each risk module (climax, swap, whipsaw, breadth, momentum) has its own independent try-catch. A climax failure doesn't prevent swap from running.

In `api/nightly/route.ts`, swap/whipsaw/breadth/momentum are wrapped in a SINGLE try-catch block (Lines 261-393). If swap fails, breadth and momentum are also skipped.

**Risk:** Partial module data loss on error. When the swap DB query fails (e.g., no scan data), everything after it in that block is also lost.

---

### Failure Isolation Verification

| Check | nightly.ts | api/nightly/route.ts |
|-------|-----------|---------------------|
| Each step in try-catch | ✅ | ✅ (but modules are grouped) |
| `hadFailure` flag tracks errors | ✅ | ✅ |
| Steps continue after failure | ✅ | ✅ |
| Heartbeat in outer try + outer catch | ✅ Lines 647 + 670 | ✅ Lines 602 + 627 |
| Heartbeat records `hadFailure` flag | ✅ | ✅ |
| Outer catch also writes heartbeat | ✅ Lines 668-675 | ✅ Lines 625-632 |

### Heartbeat Always Writes — ✅ Confirmed

Both files have two heartbeat write points:
1. **Happy path** (inside the main try block) — writes SUCCESS or FAILED based on `hadFailure`
2. **Catastrophic failure** (in the outer catch block) — writes FAILED with error message

The outer catch has its own try-catch on the heartbeat write, so even a DB failure there won't throw unhandled.

### Stop Monotonic Enforcement — ✅ Confirmed

Both `nightly.ts` and `api/nightly/route.ts` use `updateStopLoss()` for R-based and trailing ATR stops. Individual `updateStopLoss()` calls are wrapped in their own try-catch, so a monotonic violation just skips that stop (silently, which is correct behaviour).

---

## Consolidated Recommendations

### 🔴 Fix Now (affects real money safety)

1. **`settings/route.ts` PUT** — Add Zod validation for the request body. The `equity` field flows directly into position sizing. An invalid value here corrupts all downstream calculations.

### 🟡 Fix Soon (parity/reliability)

2. **Nightly API route parity** — Add the 30-ticker breadth sample optimization from `nightly.ts` to `api/nightly/route.ts` to prevent timeouts.

3. **Nightly API route parity** — Split the single try-catch around modules (swap/whipsaw/breadth/momentum) into individual try-catches, matching `nightly.ts`.

4. **`scan/snapshots/route.ts` DELETE** — Add Zod validation for the `{ id }` body and wrap `request.json()` in try-catch.

### 🟢 Low Priority (code health)

5. **`modules/route.ts`** — Replace `prisma as unknown as Record<...>` casts with proper Prisma model access (or add `regimeHistory` to schema if it exists).

6. **Consider adding `preCacheHistoricalData()`** to the API nightly route to match the cron version's warm-cache behavior.

---

## Files Audited

| # | Route Path | File | Lines |
|---|-----------|------|-------|
| 1 | `/api/auth/[...nextauth]` | `src/app/api/auth/[...nextauth]/route.ts` | 7 |
| 2 | `/api/auth/register` | `src/app/api/auth/register/route.ts` | 53 |
| 3 | `/api/health-check` | `src/app/api/health-check/route.ts` | 46 |
| 4 | `/api/heartbeat` | `src/app/api/heartbeat/route.ts` | 55 |
| 5 | `/api/market-data` | `src/app/api/market-data/route.ts` | 97 |
| 6 | `/api/modules` | `src/app/api/modules/route.ts` | 585 |
| 7 | `/api/modules/early-bird` | `src/app/api/modules/early-bird/route.ts` | 68 |
| 8 | `/api/nightly` | `src/app/api/nightly/route.ts` | 668 |
| 9 | `/api/plan` | `src/app/api/plan/route.ts` | 79 |
| 10 | `/api/portfolio/summary` | `src/app/api/portfolio/summary/route.ts` | 195 |
| 11 | `/api/positions` | `src/app/api/positions/route.ts` | 505 |
| 12 | `/api/positions/hedge` | `src/app/api/positions/hedge/route.ts` | 129 |
| 13 | `/api/publications` | `src/app/api/publications/route.ts` | 97 |
| 14 | `/api/risk` | `src/app/api/risk/route.ts` | 136 |
| 15 | `/api/scan` | `src/app/api/scan/route.ts` | 268 |
| 16 | `/api/scan/cross-ref` | `src/app/api/scan/cross-ref/route.ts` | 394 |
| 17 | `/api/scan/live-prices` | `src/app/api/scan/live-prices/route.ts` | 55 |
| 18 | `/api/scan/scores` | `src/app/api/scan/scores/route.ts` | 182 |
| 19 | `/api/scan/snapshots` | `src/app/api/scan/snapshots/route.ts` | 235 |
| 20 | `/api/scan/snapshots/sync` | `src/app/api/scan/snapshots/sync/route.ts` | 27 |
| 21 | `/api/settings` | `src/app/api/settings/route.ts` | 113 |
| 22 | `/api/settings/telegram-test` | `src/app/api/settings/telegram-test/route.ts` | 58 |
| 23 | `/api/stocks` | `src/app/api/stocks/route.ts` | 201 |
| 24 | `/api/stops` | `src/app/api/stops/route.ts` | 147 |
| 25 | `/api/stops/sync` | `src/app/api/stops/sync/route.ts` | 249 |
| 26 | `/api/stops/t212` | `src/app/api/stops/t212/route.ts` | 430 |
| 27 | `/api/trade-log` | `src/app/api/trade-log/route.ts` | 69 |
| 28 | `/api/trade-log/summary` | `src/app/api/trade-log/summary/route.ts` | 154 |
| 29 | `/api/trading212/connect` | `src/app/api/trading212/connect/route.ts` | 154 |
| 30 | `/api/trading212/sync` | `src/app/api/trading212/sync/route.ts` | 528 |
| — | Nightly cron | `src/cron/nightly.ts` | 689 |

