/**
 * DEPENDENCIES
 * Consumed by: scan-engine.ts (hook), /api/analytics/filter-attribution/route.ts
 * Consumes: prisma.ts, @/types
 * Risk-sensitive: NO — analytics only, never blocks trades
 * Last modified: 2026-03-06
 * Notes: Records filter pass/fail for every scan candidate. Fire-and-forget:
 *        failures are logged but never disrupt the scan pipeline.
 */
import type { ScanCandidate, FilterAttributionRecord } from '@/types';
import prisma from './prisma';

/**
 * Extract a FilterAttributionRecord from a ScanCandidate.
 * Pure function — no DB calls.
 */
export function extractAttribution(
  candidate: ScanCandidate,
  scanId: string,
  regime: string
): FilterAttributionRecord {
  return {
    ticker: candidate.ticker,
    scanId,
    regime,
    sleeve: candidate.sleeve,
    status: candidate.status,
    priceAboveMa200: candidate.filterResults.priceAboveMa200,
    ma200Value: candidate.technicals.ma200,
    adxAbove20: candidate.filterResults.adxAbove20,
    adxValue: candidate.technicals.adx,
    plusDIAboveMinusDI: candidate.filterResults.plusDIAboveMinusDI,
    plusDIValue: candidate.technicals.plusDI,
    minusDIValue: candidate.technicals.minusDI,
    atrPctBelow8: candidate.filterResults.atrPercentBelow8,
    atrPctValue: candidate.technicals.atrPercent,
    dataQuality: candidate.filterResults.dataQuality,
    efficiencyAbove30: candidate.filterResults.efficiencyAbove30,
    efficiencyValue: candidate.technicals.efficiency,
    hurstExponent: candidate.filterResults.hurstExponent ?? null,
    hurstWarn: candidate.filterResults.hurstWarn ?? false,
    atrSpiking: candidate.filterResults.atrSpiking ?? false,
    atrSpikeAction: candidate.filterResults.atrSpikeAction ?? null,
    distancePct: candidate.distancePercent,
    passesRiskGates: candidate.passesRiskGates ?? true,
    riskGatesFailed: candidate.riskGateResults
      ?.filter((g) => !g.passed)
      .map((g) => g.gate)
      .join(',') || null,
    passesAntiChase: candidate.passesAntiChase ?? true,
    antiChaseReason: candidate.antiChaseResult?.reason ?? null,
    earningsAction: candidate.earningsInfo?.action ?? null,
    daysToEarnings: candidate.earningsInfo?.daysUntilEarnings ?? null,
    passesAllFilters: candidate.passesAllFilters,
    rankScore: candidate.rankScore,
  };
}

/**
 * Persist filter attribution records for a batch of scan candidates.
 * Fire-and-forget: errors are logged, never thrown.
 */
export async function saveFilterAttributions(
  candidates: ScanCandidate[],
  scanId: string,
  regime: string
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  const records = candidates.map((c) => extractAttribution(c, scanId, regime));

  // Batch insert in chunks of 50 to stay within SQLite limits
  const CHUNK = 50;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    try {
      await prisma.filterAttribution.createMany({
        data: chunk.map((r) => ({
          scanId: r.scanId,
          ticker: r.ticker,
          regime: r.regime,
          sleeve: r.sleeve,
          status: r.status,
          priceAboveMa200: r.priceAboveMa200,
          ma200Value: r.ma200Value,
          adxAbove20: r.adxAbove20,
          adxValue: r.adxValue,
          plusDIAboveMinusDI: r.plusDIAboveMinusDI,
          plusDIValue: r.plusDIValue,
          minusDIValue: r.minusDIValue,
          atrPctBelow8: r.atrPctBelow8,
          atrPctValue: r.atrPctValue,
          dataQuality: r.dataQuality,
          efficiencyAbove30: r.efficiencyAbove30,
          efficiencyValue: r.efficiencyValue,
          hurstExponent: r.hurstExponent,
          hurstWarn: r.hurstWarn,
          atrSpiking: r.atrSpiking,
          atrSpikeAction: r.atrSpikeAction,
          distancePct: r.distancePct,
          passesRiskGates: r.passesRiskGates,
          riskGatesFailed: r.riskGatesFailed,
          passesAntiChase: r.passesAntiChase,
          antiChaseReason: r.antiChaseReason,
          earningsAction: r.earningsAction,
          daysToEarnings: r.daysToEarnings,
          passesAllFilters: r.passesAllFilters,
          rankScore: r.rankScore,
        })),
      });
      saved += chunk.length;
    } catch (e) {
      console.error('[FilterAttribution] Batch insert failed:', e);
      errors += chunk.length;
    }
  }

  return { saved, errors };
}

/**
 * Backfill outcome R-multiples from closed trades into FilterAttribution rows.
 * Called periodically or on-demand to link filter decisions to outcomes.
 */
export async function backfillFilterOutcomes(): Promise<number> {
  // Find closed trades that have matching FilterAttribution rows without outcomes
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
    // Match attribution by ticker + scan date within ±2 days of trade date
    const startDate = new Date(trade.tradeDate);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(trade.tradeDate);
    endDate.setDate(endDate.getDate() + 2);

    try {
      const result = await prisma.filterAttribution.updateMany({
        where: {
          ticker: trade.ticker,
          scanDate: { gte: startDate, lte: endDate },
          tradeLogId: null, // not yet backfilled
        },
        data: {
          tradeLogId: trade.id,
          outcomeR: trade.finalRMultiple,
        },
      });
      updated += result.count;
    } catch {
      // Non-critical — continue
    }
  }

  return updated;
}
