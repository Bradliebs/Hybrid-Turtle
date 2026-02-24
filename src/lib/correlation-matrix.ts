/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, /api/risk/correlation/route.ts, heatmap-swap.ts
 * Consumes: market-data.ts, prisma.ts
 * Risk-sensitive: NO (advisory warnings only — no hard blocks)
 * Last modified: 2026-02-24
 * Notes: Computes pairwise Pearson correlation on 90 days of daily returns.
 *        Flags pairs > 0.75 as HIGH_CORR. Runs nightly only (not real-time).
 */

import 'server-only';
import prisma from '@/lib/prisma';
import { getDailyPrices } from '@/lib/market-data';

const LOOKBACK_DAYS = 90;
const HIGH_CORR_THRESHOLD = 0.75;
const MIN_OVERLAP_DAYS = 60; // Need at least 60 overlapping trading days

export interface CorrelationPair {
  tickerA: string;
  tickerB: string;
  correlation: number;
  flag: 'HIGH_CORR';
}

export interface CorrelationResult {
  pairs: CorrelationPair[];
  tickersProcessed: number;
  tickersFailed: string[];
  computedAt: Date;
}

/**
 * Compute daily log returns from close prices.
 * Bars must be sorted newest-first (as getDailyPrices returns).
 */
function computeDailyReturns(
  closes: { date: string; close: number }[]
): Map<string, number> {
  const returns = new Map<string, number>();
  // Walk from oldest to newest: closes are newest-first, so reverse
  for (let i = closes.length - 1; i > 0; i--) {
    const prev = closes[i];
    const curr = closes[i - 1];
    if (prev.close > 0 && curr.close > 0) {
      returns.set(curr.date, Math.log(curr.close / prev.close));
    }
  }
  return returns;
}

/**
 * Pearson correlation coefficient between two aligned return series.
 * Returns null if insufficient overlapping data points.
 */
function pearsonCorrelation(
  returnsA: Map<string, number>,
  returnsB: Map<string, number>
): number | null {
  // Find overlapping dates
  const commonDates: string[] = [];
  const datesA = Array.from(returnsA.keys());
  for (const date of datesA) {
    if (returnsB.has(date)) commonDates.push(date);
  }

  if (commonDates.length < MIN_OVERLAP_DAYS) return null;

  const n = commonDates.length;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;

  for (const date of commonDates) {
    const a = returnsA.get(date)!;
    const b = returnsB.get(date)!;
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumA2 += a * a;
    sumB2 += b * b;
  }

  const denominator = Math.sqrt(
    (n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB)
  );

  if (denominator === 0) return null;

  return (n * sumAB - sumA * sumB) / denominator;
}

/**
 * Run the full correlation matrix computation for open + watched tickers.
 * Fetches 90 days of daily returns, computes pairwise Pearson correlation,
 * flags pairs > 0.75 as HIGH_CORR, and caches results in DB.
 *
 * Designed to run in the nightly batch only — not real-time.
 */
export async function computeCorrelationMatrix(): Promise<CorrelationResult> {
  const now = new Date();

  // Gather tickers: open positions + WATCH/READY from latest scan
  const [openPositions, latestScan] = await Promise.all([
    prisma.position.findMany({
      where: { status: 'OPEN' },
      include: { stock: { select: { ticker: true } } },
    }),
    prisma.scan.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          where: { status: { in: ['READY', 'WATCH'] } },
          include: { stock: { select: { ticker: true } } },
        },
      },
    }),
  ]);

  const tickerSet = new Set<string>();
  for (const p of openPositions) tickerSet.add(p.stock.ticker);
  if (latestScan) {
    for (const r of latestScan.results) tickerSet.add(r.stock.ticker);
  }
  const tickers = Array.from(tickerSet).sort();

  if (tickers.length < 2) {
    return { pairs: [], tickersProcessed: tickers.length, tickersFailed: [], computedAt: now };
  }

  // Fetch daily prices and compute returns for each ticker
  // getDailyPrices('compact') returns ~100 days — sufficient for 90-day window
  const returnsMap = new Map<string, Map<string, number>>();
  const failed: string[] = [];

  const BATCH_SIZE = 10;
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const bars = await getDailyPrices(ticker, 'compact');
        // Take only the most recent 91 bars (need N+1 for N returns)
        const recentBars = bars.slice(0, LOOKBACK_DAYS + 1);
        if (recentBars.length < MIN_OVERLAP_DAYS + 1) {
          throw new Error(`Insufficient data: ${recentBars.length} bars`);
        }
        const returns = computeDailyReturns(recentBars);
        returnsMap.set(ticker, returns);
      })
    );
    results.forEach((r, idx) => {
      if (r.status === 'rejected') failed.push(batch[idx]);
    });
  }

  const validTickers = tickers.filter((t) => returnsMap.has(t));
  const highCorrPairs: CorrelationPair[] = [];

  // Compute pairwise correlations (upper triangle only)
  for (let i = 0; i < validTickers.length; i++) {
    for (let j = i + 1; j < validTickers.length; j++) {
      const a = validTickers[i];
      const b = validTickers[j];
      const corr = pearsonCorrelation(returnsMap.get(a)!, returnsMap.get(b)!);
      if (corr !== null && corr > HIGH_CORR_THRESHOLD) {
        // Enforce alphabetical order for consistent storage
        const [tickerA, tickerB] = a < b ? [a, b] : [b, a];
        highCorrPairs.push({
          tickerA,
          tickerB,
          correlation: Math.round(corr * 1000) / 1000, // 3 decimal places
          flag: 'HIGH_CORR',
        });
      }
    }
  }

  // Persist to DB: delete old flags, write new batch in a transaction
  await prisma.$transaction([
    prisma.correlationFlag.deleteMany({}),
    ...highCorrPairs.map((pair) =>
      prisma.correlationFlag.create({
        data: {
          tickerA: pair.tickerA,
          tickerB: pair.tickerB,
          correlation: pair.correlation,
          flag: pair.flag,
          computedAt: now,
        },
      })
    ),
  ]);

  console.log(`[Correlation] ${highCorrPairs.length} HIGH_CORR pairs from ${validTickers.length} tickers (${failed.length} failed)`);

  return {
    pairs: highCorrPairs,
    tickersProcessed: validTickers.length,
    tickersFailed: failed,
    computedAt: now,
  };
}

/**
 * Get cached HIGH_CORR flags involving a specific ticker.
 * Used by Module 7 (heatmap-swap) to surface warnings.
 */
export async function getCorrelationFlags(ticker: string): Promise<CorrelationPair[]> {
  const flags = await prisma.correlationFlag.findMany({
    where: {
      OR: [{ tickerA: ticker }, { tickerB: ticker }],
    },
  });
  return flags.map((f) => ({
    tickerA: f.tickerA,
    tickerB: f.tickerB,
    correlation: f.correlation,
    flag: f.flag as 'HIGH_CORR',
  }));
}

/**
 * Get all cached HIGH_CORR flags.
 * Used by the /risk page correlation widget.
 */
export async function getAllCorrelationFlags(): Promise<CorrelationPair[]> {
  const flags = await prisma.correlationFlag.findMany({
    orderBy: { correlation: 'desc' },
  });
  return flags.map((f) => ({
    tickerA: f.tickerA,
    tickerB: f.tickerB,
    correlation: f.correlation,
    flag: f.flag as 'HIGH_CORR',
  }));
}

/**
 * Check if adding a new ticker would create HIGH_CORR with any existing open position.
 * Returns the list of correlated tickers (warnings, not blocks).
 */
export async function checkCorrelationWarnings(
  candidateTicker: string,
  openTickers: string[]
): Promise<{ ticker: string; correlation: number }[]> {
  if (openTickers.length === 0) return [];

  const flags = await getCorrelationFlags(candidateTicker);
  const warnings: { ticker: string; correlation: number }[] = [];

  for (const flag of flags) {
    const otherTicker = flag.tickerA === candidateTicker ? flag.tickerB : flag.tickerA;
    if (openTickers.includes(otherTicker)) {
      warnings.push({ ticker: otherTicker, correlation: flag.correlation });
    }
  }

  return warnings;
}
