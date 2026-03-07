/**
 * DEPENDENCIES
 * Consumed by: irm-trainer.ts
 * Consumes: prisma.ts (TradeLog, ScoreBreakdown, RegimeHistory tables)
 * Risk-sensitive: NO — data partitioning only
 * Last modified: 2026-03-07
 * Notes: Partitions historical data into regime environments for IRM.
 *        Priority: real TradeLog outcomes → ScoreBreakdown NCS proxy.
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────

export type IRMEnvironment = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION';

export const IRM_ENVIRONMENTS: IRMEnvironment[] = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];

export interface EnvironmentData {
  environment: IRMEnvironment;
  /** Each row: [signal_values..., outcome] */
  samples: Array<{ signals: number[]; outcome: number }>;
}

export type IRMDataSource = 'TRADELOG' | 'SCORE_PROXY' | 'INSUFFICIENT_DATA';

export interface DataSourceMeta {
  source: IRMDataSource;
  tradesUsed: number;
  scanMatchRate: number;
  regimeCounts: Record<string, number>;
  lowSampleRegimes: string[];
  message?: string;
}

export const SIGNAL_NAMES = [
  'bqsTrend', 'bqsDirection', 'bqsVolatility', 'bqsProximity',
  'bqsTailwind', 'bqsRs', 'bqsWeeklyAdx', 'bqsBis', 'bqsHurst', 'bqsVolBonus',
] as const;

export const SIGNAL_COUNT = SIGNAL_NAMES.length;

// ── Regime Mapping ───────────────────────────────────────────

function mapRegime(regime: string): IRMEnvironment {
  const upper = regime.toUpperCase();
  if (upper === 'BULLISH') return 'TRENDING';
  if (upper === 'BEARISH' || upper === 'SIDEWAYS' || upper === 'NEUTRAL') return 'RANGING';
  if (upper.includes('VOLATILE') || upper.includes('HIGH_VOL')) return 'VOLATILE';
  return 'TRANSITION';
}

// ── TradeLog-based Data Loading ──────────────────────────────

/**
 * Build IRM dataset from real trade outcomes joined with ScoreBreakdown signals.
 * Returns null if insufficient data (< 10 completed trades).
 */
async function buildTradeLogDataset(): Promise<{
  envData: EnvironmentData[];
  meta: DataSourceMeta;
} | null> {
  // A. Query all completed trades with valid R-multiples
  const completedTrades = await prisma.tradeLog.findMany({
    where: {
      exitPrice: { not: null },
      finalRMultiple: { not: null },
    },
    select: {
      ticker: true,
      tradeDate: true,
      entryPrice: true,
      exitPrice: true,
      finalRMultiple: true,
      regime: true,
    },
    orderBy: { tradeDate: 'desc' },
  });

  // Filter out non-finite R-multiples
  const validTrades = completedTrades.filter(
    t => t.finalRMultiple !== null && Number.isFinite(t.finalRMultiple)
  );

  if (validTrades.length < 10) {
    return null; // Insufficient data — caller decides fallback
  }

  // B. For each trade, find matching ScoreBreakdown within ±3 days
  const MS_3_DAYS = 3 * 24 * 60 * 60 * 1000;
  let matchedCount = 0;
  const unmatchedTickers: string[] = [];

  const envMap = new Map<IRMEnvironment, EnvironmentData>();
  for (const env of IRM_ENVIRONMENTS) {
    envMap.set(env, { environment: env, samples: [] });
  }

  const regimeCounts: Record<string, number> = {};

  for (const trade of validTrades) {
    const entryTime = trade.tradeDate.getTime();

    // Find closest ScoreBreakdown for this ticker within ±3 days
    const matchingScores = await prisma.scoreBreakdown.findMany({
      where: {
        ticker: trade.ticker,
        scoredAt: {
          gte: new Date(entryTime - MS_3_DAYS),
          lte: new Date(entryTime + MS_3_DAYS),
        },
      },
      orderBy: { scoredAt: 'desc' },
      take: 5,
    });

    if (matchingScores.length === 0) {
      unmatchedTickers.push(trade.ticker);
      continue;
    }

    // Pick the ScoreBreakdown closest to entry date
    const closest = matchingScores.reduce((best, row) => {
      const dist = Math.abs(row.scoredAt.getTime() - entryTime);
      const bestDist = Math.abs(best.scoredAt.getTime() - entryTime);
      return dist < bestDist ? row : best;
    });

    matchedCount++;

    // C. Determine regime
    let regime: string = 'UNKNOWN';
    if (trade.regime) {
      regime = trade.regime;
    } else {
      // Look up RegimeHistory for trade entry date
      const regimeRow = await prisma.regimeHistory.findFirst({
        where: { date: { lte: trade.tradeDate } },
        orderBy: { date: 'desc' },
        select: { regime: true },
      });
      if (regimeRow) {
        regime = regimeRow.regime;
      } else if (closest.regime) {
        regime = closest.regime;
      }
    }

    const irmEnv = mapRegime(regime);
    regimeCounts[irmEnv] = (regimeCounts[irmEnv] || 0) + 1;

    // D. Build sample row
    const signals = [
      closest.bqsTrend, closest.bqsDirection, closest.bqsVolatility, closest.bqsProximity,
      closest.bqsTailwind, closest.bqsRs, closest.bqsWeeklyAdx, closest.bqsBis,
      closest.bqsHurst, closest.bqsVolBonus,
    ];

    // Binary outcome: win if R > 0.5
    const outcome = trade.finalRMultiple! > 0.5 ? 1 : 0;

    // Skip rows where regime is UNKNOWN from per-regime beta
    // but still include in the dataset (using TRANSITION as catch-all)
    envMap.get(irmEnv)!.samples.push({ signals, outcome });
  }

  if (matchedCount < 10) {
    return null; // Not enough matched pairs
  }

  // Warn if match rate is low
  const matchRate = matchedCount / validTrades.length;
  if (matchRate < 0.7) {
    console.warn(
      `[IRM] WARNING: ${Math.round((1 - matchRate) * 100)}% of trades have no matching scan result. ` +
      `Consider running a backfill scan or widening the match window.`
    );
  }

  // Identify low-sample regimes
  const lowSampleRegimes = IRM_ENVIRONMENTS.filter(
    env => (regimeCounts[env] || 0) > 0 && (regimeCounts[env] || 0) < 5
  );

  console.log(`[IRM] Dataset: ${matchedCount} trades matched to scan results (${Math.round(matchRate * 100)}% match rate)`);
  console.log(`[IRM] Regime counts: ${IRM_ENVIRONMENTS.map(e => `${e}=${regimeCounts[e] || 0}`).join(', ')}`);

  return {
    envData: IRM_ENVIRONMENTS.map(env => envMap.get(env)!),
    meta: {
      source: 'TRADELOG',
      tradesUsed: matchedCount,
      scanMatchRate: Math.round(matchRate * 100),
      regimeCounts,
      lowSampleRegimes,
    },
  };
}

// ── ScoreBreakdown Proxy Fallback ────────────────────────────

/**
 * Fallback: load from ScoreBreakdown using NCS as outcome proxy.
 * Used when no TradeLog data exists.
 */
async function buildScoreProxyDataset(minSamplesPerEnv: number): Promise<{
  envData: EnvironmentData[];
  meta: DataSourceMeta;
}> {
  const rows = await prisma.scoreBreakdown.findMany({
    select: {
      regime: true,
      bqsTrend: true, bqsDirection: true, bqsVolatility: true,
      bqsProximity: true, bqsTailwind: true, bqsRs: true,
      bqsWeeklyAdx: true, bqsBis: true, bqsHurst: true,
      bqsVolBonus: true, ncsTotal: true, outcomeR: true,
    },
    orderBy: { scoredAt: 'desc' },
    take: 3000,
  });

  const envMap = new Map<IRMEnvironment, EnvironmentData>();
  for (const env of IRM_ENVIRONMENTS) {
    envMap.set(env, { environment: env, samples: [] });
  }

  const regimeCounts: Record<string, number> = {};

  for (const row of rows) {
    const env = mapRegime(row.regime);
    regimeCounts[env] = (regimeCounts[env] || 0) + 1;
    const data = envMap.get(env)!;

    const signals = [
      row.bqsTrend, row.bqsDirection, row.bqsVolatility, row.bqsProximity,
      row.bqsTailwind, row.bqsRs, row.bqsWeeklyAdx, row.bqsBis,
      row.bqsHurst, row.bqsVolBonus,
    ];

    // Outcome: real R-multiple if backfilled, else NCS as proxy
    const outcome = row.outcomeR ?? row.ncsTotal / 100;

    data.samples.push({ signals, outcome });
  }

  const lowSampleRegimes = IRM_ENVIRONMENTS.filter(
    env => (regimeCounts[env] || 0) > 0 && (regimeCounts[env] || 0) < 5
  );

  return {
    envData: IRM_ENVIRONMENTS
      .map(env => envMap.get(env)!)
      .filter(ed => ed.samples.length >= minSamplesPerEnv),
    meta: {
      source: 'SCORE_PROXY',
      tradesUsed: 0,
      scanMatchRate: 0,
      regimeCounts,
      lowSampleRegimes,
      message: 'Using NCS scores as outcome proxy — no completed trades available for real outcome analysis.',
    },
  };
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Load data and partition into regime environments for IRM.
 * Priority: TradeLog real outcomes → ScoreBreakdown NCS proxy.
 */
export async function loadEnvironmentData(minSamplesPerEnv = 20): Promise<{
  envData: EnvironmentData[];
  meta: DataSourceMeta;
}> {
  // Try real trade outcomes first
  const tradeResult = await buildTradeLogDataset();
  if (tradeResult && tradeResult.envData.some(e => e.samples.length >= minSamplesPerEnv)) {
    // Filter environments with enough samples
    tradeResult.envData = tradeResult.envData.filter(
      ed => ed.samples.length >= minSamplesPerEnv
    );
    return tradeResult;
  }

  // If trades exist but not enough per-regime, still use them with lower threshold
  if (tradeResult && tradeResult.meta.tradesUsed >= 10) {
    // Use minimum 3 samples per environment for small datasets
    tradeResult.envData = tradeResult.envData.filter(ed => ed.samples.length >= 3);
    if (tradeResult.envData.length >= 2) {
      return tradeResult;
    }
  }

  // Fall back to ScoreBreakdown proxy
  console.log('[IRM] No trade outcomes available — using ScoreBreakdown NCS proxy');
  return buildScoreProxyDataset(minSamplesPerEnv);
}
