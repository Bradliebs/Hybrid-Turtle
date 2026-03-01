/**
 * DEPENDENCIES
 * Consumed by: scan-engine.ts, nightly.ts, snapshot-sync.ts
 * Consumes: market-data.ts (getEarningsDate), prisma.ts
 * Risk-sensitive: YES — can block or demote trade candidates
 * Last modified: 2026-03-01
 * Notes: Earnings within 1-2 days → AUTO_NO (hard block, HIGH confidence only).
 *        Earnings within 3-5 days → demote to WATCH.
 *        Fail-safe: if no data available, skip check — absence of data is not evidence of no earnings.
 */

import prisma from './prisma';
import { getEarningsDate } from './market-data';

// ── Types ─────────────────────────────────────────────────────

export interface EarningsInfo {
  ticker: string;
  nextEarningsDate: Date | null;
  daysUntilEarnings: number | null;
  source: 'YAHOO' | 'CACHED' | 'UNKNOWN';
  confidence: 'HIGH' | 'LOW' | 'NONE';
}

export interface EarningsCheckResult {
  /** true if earnings are close enough to affect the candidate */
  hasEarningsRisk: boolean;
  /** AUTO_NO for ≤2 days (HIGH confidence only), WATCH for 3-5 days, null otherwise */
  action: 'AUTO_NO' | 'DEMOTE_WATCH' | null;
  /** Human-readable reason for the action */
  reason: string | null;
  /** Underlying earnings info */
  info: EarningsInfo;
}

// Cache entries older than this are stale and should be re-fetched
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Core Functions ────────────────────────────────────────────

/**
 * Get earnings info for a ticker, preferring DB cache.
 * If cache is fresh (< 24h), returns cached data.
 * Otherwise fetches from Yahoo and updates cache.
 */
export async function getEarningsInfo(ticker: string): Promise<EarningsInfo> {
  // 1. Check DB cache
  try {
    const cached = await prisma.earningsCache.findUnique({
      where: { ticker },
    });

    if (cached && isCacheFresh(cached.fetchedAt)) {
      const daysUntil = cached.nextEarningsDate
        ? calculateDaysUntil(cached.nextEarningsDate)
        : null;

      return {
        ticker,
        nextEarningsDate: cached.nextEarningsDate,
        daysUntilEarnings: daysUntil,
        source: 'CACHED',
        confidence: cached.confidence as 'HIGH' | 'LOW' | 'NONE',
      };
    }
  } catch (err) {
    // DB read failed — fall through to Yahoo fetch
    console.warn(`[Earnings] Cache read failed for ${ticker}:`, (err as Error).message);
  }

  // 2. Fetch from Yahoo
  return fetchAndCacheEarnings(ticker);
}

/**
 * Fetch earnings date from Yahoo and write to DB cache.
 * Used by both getEarningsInfo (on cache miss) and nightly pre-cache.
 */
export async function fetchAndCacheEarnings(ticker: string): Promise<EarningsInfo> {
  try {
    const result = await getEarningsDate(ticker);

    // Write to cache (upsert — insert or update)
    try {
      await prisma.earningsCache.upsert({
        where: { ticker },
        create: {
          ticker,
          nextEarningsDate: result.earningsDate,
          confidence: result.confidence,
          fetchedAt: new Date(),
          source: 'YAHOO',
        },
        update: {
          nextEarningsDate: result.earningsDate,
          confidence: result.confidence,
          fetchedAt: new Date(),
          source: 'YAHOO',
        },
      });
    } catch (dbErr) {
      // Cache write failure is non-fatal — we still have the data
      console.warn(`[Earnings] Cache write failed for ${ticker}:`, (dbErr as Error).message);
    }

    const daysUntil = result.earningsDate
      ? calculateDaysUntil(result.earningsDate)
      : null;

    return {
      ticker,
      nextEarningsDate: result.earningsDate,
      daysUntilEarnings: daysUntil,
      source: 'YAHOO',
      confidence: result.confidence,
    };
  } catch (err) {
    // Fail safe — never crash the scan
    console.warn(`[Earnings] Fetch failed for ${ticker}:`, (err as Error).message);
    return {
      ticker,
      nextEarningsDate: null,
      daysUntilEarnings: null,
      source: 'UNKNOWN',
      confidence: 'NONE',
    };
  }
}

/**
 * Evaluate whether a candidate should be blocked or demoted due to earnings.
 *
 * Rules:
 *   ≤2 days + HIGH confidence → AUTO_NO (hard block, cannot override)
 *   ≤2 days + LOW confidence  → warning only (estimated date — verify before trading)
 *   3-5 days                  → DEMOTE_WATCH (demote READY → WATCH)
 *   >5 days or unknown        → no action
 *   NONE confidence           → skip entirely (no data ≠ no earnings)
 */
export function evaluateEarningsRisk(info: EarningsInfo): EarningsCheckResult {
  const { daysUntilEarnings, confidence } = info;

  // No data available — skip check, don't penalise
  if (daysUntilEarnings === null || confidence === 'NONE') {
    return {
      hasEarningsRisk: false,
      action: null,
      reason: null,
      info,
    };
  }

  // Earnings already passed (negative days) — no risk
  if (daysUntilEarnings < 0) {
    return {
      hasEarningsRisk: false,
      action: null,
      reason: null,
      info,
    };
  }

  // ≤2 days — high risk zone
  if (daysUntilEarnings <= 2) {
    if (confidence === 'HIGH') {
      return {
        hasEarningsRisk: true,
        action: 'AUTO_NO',
        reason: `Earnings in ${daysUntilEarnings} day${daysUntilEarnings === 1 ? '' : 's'} — too risky`,
        info,
      };
    }
    // LOW confidence — warn but don't hard block
    return {
      hasEarningsRisk: true,
      action: 'DEMOTE_WATCH',
      reason: `⚠ Estimated earnings ~${daysUntilEarnings} day${daysUntilEarnings === 1 ? '' : 's'} (unconfirmed — verify before trading)`,
      info,
    };
  }

  // 3-5 days — moderate risk zone
  if (daysUntilEarnings <= 5) {
    return {
      hasEarningsRisk: true,
      action: 'DEMOTE_WATCH',
      reason: `Earnings in ${daysUntilEarnings} days — wait for result`,
      info,
    };
  }

  // >5 days — no action needed
  return {
    hasEarningsRisk: false,
    action: null,
    reason: null,
    info,
  };
}

/**
 * Pre-cache earnings dates for a batch of tickers.
 * Processes in batches with delay to respect Yahoo rate limits.
 * Used by the nightly pipeline.
 */
export async function preCacheEarningsBatch(
  tickers: string[],
  batchSize = 5,
  delayMs = 500,
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(ticker => fetchAndCacheEarnings(ticker))
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        success++;
      } else {
        failed++;
        errors.push(`${batch[j]}: ${(results[j] as PromiseRejectedResult).reason}`);
      }
    }

    // Pause between batches to respect Yahoo rate limits
    if (i + batchSize < tickers.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { success, failed, errors };
}

// ── Helpers ───────────────────────────────────────────────────

function isCacheFresh(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() < CACHE_TTL_MS;
}

/**
 * Calculate days until a target date from now.
 * Returns 0 if today, negative if in the past.
 * Uses calendar days (midnight-to-midnight), not 24h blocks.
 */
function calculateDaysUntil(target: Date): number {
  const now = new Date();
  // Normalise to midnight for calendar-day comparison
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffMs = targetMidnight.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
