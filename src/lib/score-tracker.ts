/**
 * DEPENDENCIES
 * Consumed by: nightly.ts (snapshot sync hook), /api/analytics/score-contribution/route.ts
 * Consumes: dual-score.ts, prisma.ts
 * Risk-sensitive: NO — analytics only
 * Last modified: 2026-03-06
 * Notes: Stores full BQS/FWS/NCS component breakdown per snapshot ticker.
 *        Enables correlation of individual score components with trade outcomes.
 */
import type { ScoreBreakdownRecord } from '@/types';
import type { ScoredTicker } from './dual-score';
import prisma from './prisma';

/**
 * Extract a ScoreBreakdownRecord from a ScoredTicker.
 * Pure function — no DB calls.
 */
export function extractScoreBreakdown(
  scored: ScoredTicker,
  snapshotId: string,
  regime: string
): ScoreBreakdownRecord {
  return {
    ticker: scored.ticker,
    snapshotId,
    regime,
    sleeve: scored.sleeve ?? null,
    bqsTrend: scored.bqs_trend,
    bqsDirection: scored.bqs_direction,
    bqsVolatility: scored.bqs_volatility,
    bqsProximity: scored.bqs_proximity,
    bqsTailwind: scored.bqs_tailwind,
    bqsRs: scored.bqs_rs,
    bqsVolBonus: scored.bqs_vol_bonus,
    bqsWeeklyAdx: scored.bqs_weekly_adx,
    bqsBis: scored.bqs_bis,
    bqsHurst: scored.bqs_hurst,
    bqsTotal: scored.BQS,
    fwsVolume: scored.fws_volume,
    fwsExtension: scored.fws_extension,
    fwsMarginalTrend: scored.fws_marginal_trend,
    fwsVolShock: scored.fws_vol_shock,
    fwsRegimeInstability: scored.fws_regime_instability,
    fwsTotal: scored.FWS,
    penaltyEarnings: scored.EarningsPenalty,
    penaltyCluster: scored.ClusterPenalty,
    penaltySuperCluster: scored.SuperClusterPenalty,
    baseNcs: scored.BaseNCS,
    ncsTotal: scored.NCS,
    actionNote: scored.ActionNote,
  };
}

/**
 * Persist score breakdowns for a batch of scored tickers.
 * Fire-and-forget: errors logged, never thrown.
 */
export async function saveScoreBreakdowns(
  scoredTickers: ScoredTicker[],
  snapshotId: string,
  regime: string
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  const records = scoredTickers.map((s) => extractScoreBreakdown(s, snapshotId, regime));

  const CHUNK = 50;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    try {
      await prisma.scoreBreakdown.createMany({
        data: chunk.map((r) => ({
          snapshotId: r.snapshotId,
          ticker: r.ticker,
          regime: r.regime,
          sleeve: r.sleeve,
          bqsTrend: r.bqsTrend,
          bqsDirection: r.bqsDirection,
          bqsVolatility: r.bqsVolatility,
          bqsProximity: r.bqsProximity,
          bqsTailwind: r.bqsTailwind,
          bqsRs: r.bqsRs,
          bqsVolBonus: r.bqsVolBonus,
          bqsWeeklyAdx: r.bqsWeeklyAdx,
          bqsBis: r.bqsBis,
          bqsHurst: r.bqsHurst,
          bqsTotal: r.bqsTotal,
          fwsVolume: r.fwsVolume,
          fwsExtension: r.fwsExtension,
          fwsMarginalTrend: r.fwsMarginalTrend,
          fwsVolShock: r.fwsVolShock,
          fwsRegimeInstability: r.fwsRegimeInstability,
          fwsTotal: r.fwsTotal,
          penaltyEarnings: r.penaltyEarnings,
          penaltyCluster: r.penaltyCluster,
          penaltySuperCluster: r.penaltySuperCluster,
          baseNcs: r.baseNcs,
          ncsTotal: r.ncsTotal,
          actionNote: r.actionNote,
        })),
      });
      saved += chunk.length;
    } catch (e) {
      console.error('[ScoreBreakdown] Batch insert failed:', e);
      errors += chunk.length;
    }
  }

  return { saved, errors };
}

/**
 * Backfill outcome R-multiples from closed trades into ScoreBreakdown rows.
 */
export async function backfillScoreOutcomes(): Promise<number> {
  const closedTrades = await prisma.tradeLog.findMany({
    where: {
      finalRMultiple: { not: null },
      decision: { in: ['EXECUTED', 'BUY'] },
    },
    select: {
      id: true,
      ticker: true,
      tradeDate: true,
      finalRMultiple: true,
    },
  });

  let updated = 0;
  for (const trade of closedTrades) {
    const startDate = new Date(trade.tradeDate);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(trade.tradeDate);
    endDate.setDate(endDate.getDate() + 2);

    try {
      const result = await prisma.scoreBreakdown.updateMany({
        where: {
          ticker: trade.ticker,
          scoredAt: { gte: startDate, lte: endDate },
          tradeLogId: null,
        },
        data: {
          tradeLogId: trade.id,
          outcomeR: trade.finalRMultiple,
        },
      });
      updated += result.count;
    } catch {
      // Non-critical
    }
  }

  return updated;
}
