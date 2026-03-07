/**
 * DEPENDENCIES
 * Consumed by: nightly.ts (after trade closes), /api/prediction/beliefs/route.ts
 * Consumes: belief-state.ts, prisma.ts
 * Risk-sensitive: NO — updates belief distributions, no position changes
 * Last modified: 2026-03-07
 * Notes: After each trade closes, updates Beta distributions for signals
 *        that fired on that trade. Success = profitable, failure = loss.
 *        Only updates signals that actually fired (score > threshold).
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';
import {
  updateBelief,
  type SignalId,
  type RegimeId,
  SIGNAL_IDS,
} from './belief-state';

// ── Types ────────────────────────────────────────────────────

export interface UpdateResult {
  tradeLogId: string;
  ticker: string;
  regime: RegimeId;
  outcome: 'WIN' | 'LOSS';
  signalsUpdated: SignalId[];
}

// ── Signal Firing Thresholds ─────────────────────────────────
// A signal "fired" if its BQS component was above these thresholds at entry time.
// This determines which signals get credit/blame for the trade outcome.

const SIGNAL_FIRE_THRESHOLDS: Record<SignalId, { field: string; threshold: number }> = {
  adx: { field: 'bqsTrend', threshold: 10 },        // > 10 out of 25
  di: { field: 'bqsDirection', threshold: 4 },       // > 4 out of 10
  hurst: { field: 'bqsHurst', threshold: 3 },        // > 3 out of 8
  bis: { field: 'bqsBis', threshold: 6 },             // > 6 out of 15
  drs: { field: 'bqsTailwind', threshold: 5 },        // > 5 out of 20
  weeklyAdx: { field: 'bqsWeeklyAdx', threshold: 3 }, // > 3 out of 10
  bps: { field: 'bqsTotal', threshold: 50 },           // BPS proxy: high BQS means setup was strong
};

// ── Regime Mapping ───────────────────────────────────────────

function mapRegime(regime: string): RegimeId {
  const upper = regime.toUpperCase();
  if (upper === 'BULLISH') return 'TRENDING';
  if (upper === 'BEARISH' || upper === 'SIDEWAYS') return 'RANGING';
  if (upper.includes('VOLATILE') || upper.includes('HIGH_VOL')) return 'VOLATILE';
  return 'TRANSITION';
}

// ── Core Update Logic ────────────────────────────────────────

/**
 * Process a closed trade and update beliefs for all signals that fired.
 *
 * @param tradeLogId - ID of the closed trade
 * @param ticker - Trade ticker
 * @param regime - Market regime at trade entry
 * @param rMultiple - Final R-multiple outcome
 * @param scoreBreakdown - BQS components at entry time (from ScoreBreakdown table)
 */
export async function processTradeOutcome(
  tradeLogId: string,
  ticker: string,
  regime: string,
  rMultiple: number,
  scoreBreakdown: Record<string, number>
): Promise<UpdateResult> {
  const regimeId = mapRegime(regime);
  const isWin = rMultiple > 0;
  const signalsUpdated: SignalId[] = [];

  for (const signal of SIGNAL_IDS) {
    const config = SIGNAL_FIRE_THRESHOLDS[signal];
    const signalValue = scoreBreakdown[config.field] ?? 0;

    // Only update beliefs for signals that actually fired
    if (signalValue > config.threshold) {
      await updateBelief(signal, regimeId, isWin);
      signalsUpdated.push(signal);
    }
  }

  return {
    tradeLogId,
    ticker,
    regime: regimeId,
    outcome: isWin ? 'WIN' : 'LOSS',
    signalsUpdated,
  };
}

/**
 * Batch-process recent trade closures that haven't been processed yet.
 * Called by the nightly pipeline.
 */
export async function processRecentClosures(): Promise<{
  processed: number;
  results: UpdateResult[];
}> {
  // Find closed trades that have a score breakdown but haven't been belief-processed
  // We use tradeLogId linkage between TradeLog and ScoreBreakdown
  const recentTrades = await prisma.tradeLog.findMany({
    where: {
      exitPrice: { not: null },
      finalRMultiple: { not: null },
    },
    select: {
      id: true,
      ticker: true,
      finalRMultiple: true,
      regime: true,
    },
    orderBy: { tradeDate: 'desc' },
    take: 50,
  });

  const results: UpdateResult[] = [];

  for (const trade of recentTrades) {
    if (trade.finalRMultiple === null || !trade.regime) continue;

    // Find matching score breakdown
    const breakdown = await prisma.scoreBreakdown.findFirst({
      where: { tradeLogId: trade.id },
      select: {
        bqsTrend: true,
        bqsDirection: true,
        bqsHurst: true,
        bqsBis: true,
        bqsTailwind: true,
        bqsWeeklyAdx: true,
        bqsTotal: true,
      },
    });

    if (!breakdown) continue;

    const result = await processTradeOutcome(
      trade.id,
      trade.ticker,
      trade.regime,
      trade.finalRMultiple,
      breakdown as Record<string, number>
    );
    results.push(result);
  }

  return { processed: results.length, results };
}
