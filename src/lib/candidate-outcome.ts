/**
 * DEPENDENCIES
 * Consumed by: /api/scan/route.ts (write hook), /api/analytics/candidate-outcomes/route.ts (query)
 * Consumes: prisma.ts, @/types, market-data.ts (enrichment)
 * Risk-sensitive: NO — analytics only, never blocks trades
 * Last modified: 2026-03-06
 * Notes: Research-grade candidate outcome dataset. One row per ticker per scan.
 *        Write path is idempotent via upsert on (scanId, ticker).
 *        Forward outcome enrichment runs as a separate batch after bars are available.
 */
import type { ScanCandidate, CandidateOutcomeRecord, CandidateStage } from '@/types';
import prisma from './prisma';

// ── Pure extraction ─────────────────────────────────────────────────

/**
 * Determine the furthest pipeline stage a candidate reached.
 */
export function resolveStageReached(c: ScanCandidate): CandidateStage {
  // If sizing was computed, candidate went through all 7 stages
  if (c.shares != null && c.shares > 0) return 'SIZED';
  // If anti-chase was evaluated (result exists), reached stage 6
  if (c.antiChaseResult != null) return 'ANTI_CHASE';
  // If risk gates were evaluated, reached stage 5
  if (c.riskGateResults != null) return 'RISK_GATED';
  // If rank score > 0, reached stage 4
  if (c.rankScore > 0) return 'RANKED';
  // If status is assigned (not just from universe load), reached stage 3
  if (c.status && c.status !== 'FAR') return 'CLASSIFIED';
  // If filter results exist, reached stage 2
  if (c.filterResults) return 'TECH_FILTER';
  return 'UNIVERSE';
}

/**
 * Collect blocked reasons into a comma-separated string.
 */
export function collectBlockedReasons(c: ScanCandidate): string | null {
  const reasons: string[] = [];

  if (!c.filterResults.priceAboveMa200) reasons.push('BELOW_MA200');
  if (!c.filterResults.adxAbove20) reasons.push('ADX_LOW');
  if (!c.filterResults.plusDIAboveMinusDI) reasons.push('MINUS_DI_DOMINANT');
  if (!c.filterResults.atrPercentBelow8) reasons.push('ATR_TOO_HIGH');
  if (!c.filterResults.dataQuality) reasons.push('DATA_QUALITY');
  if (c.filterResults.atrSpikeAction === 'HARD_BLOCK') reasons.push('ATR_SPIKE_BLOCK');
  if (c.filterResults.atrSpikeAction === 'SOFT_CAP') reasons.push('ATR_SPIKE_SOFTCAP');
  if (c.filterResults.hurstWarn) reasons.push('HURST_WARN');
  if (!c.filterResults.efficiencyAbove30) reasons.push('LOW_EFFICIENCY');

  if (c.earningsInfo?.action === 'AUTO_NO') reasons.push('EARNINGS_BLOCK');
  if (c.earningsInfo?.action === 'DEMOTE_WATCH') reasons.push('EARNINGS_DEMOTE');

  if (c.riskGateResults) {
    for (const g of c.riskGateResults) {
      if (!g.passed) reasons.push(`GATE_${g.gate}`);
    }
  }

  if (c.antiChaseResult && !c.antiChaseResult.passed) {
    reasons.push(`ANTI_CHASE: ${c.antiChaseResult.reason}`);
  }

  if (c.status === 'COOLDOWN') reasons.push('COOLDOWN');

  return reasons.length > 0 ? reasons.join(', ') : null;
}

/**
 * Extract a CandidateOutcomeRecord from a ScanCandidate.
 * Pure function — no DB calls.
 */
export function extractCandidateOutcome(
  candidate: ScanCandidate,
  scanId: string,
  regime: string,
  dataFreshness?: string | null
): CandidateOutcomeRecord {
  const stageReached = resolveStageReached(candidate);
  const blockedReasons = collectBlockedReasons(candidate);

  // Regime-blocked: bearish regime is not currently a hard block in the scan
  // pipeline (it's a score penalty), but we flag it for research purposes.
  const blockedByRegime = regime === 'BEARISH';

  return {
    scanId,
    ticker: candidate.ticker,
    name: candidate.name,
    sleeve: candidate.sleeve,
    sector: candidate.sector,
    cluster: candidate.cluster,

    status: candidate.status,
    stageReached,
    passedTechFilter: candidate.passesAllFilters,
    passedRiskGates: candidate.passesRiskGates ?? false,
    passedAntiChase: candidate.passesAntiChase ?? true,
    blockedByRegime,
    blockedReasons,

    regime,

    price: candidate.price,
    ma200: candidate.technicals.ma200,
    adx: candidate.technicals.adx,
    plusDI: candidate.technicals.plusDI,
    minusDI: candidate.technicals.minusDI,
    atrPct: candidate.technicals.atrPercent,
    atr: candidate.technicals.atr,
    efficiency: candidate.technicals.efficiency,
    volumeRatio: candidate.technicals.volumeRatio,
    relativeStrength: candidate.technicals.relativeStrength,
    hurstExponent: candidate.filterResults.hurstExponent ?? null,
    hurstWarn: candidate.filterResults.hurstWarn ?? false,
    atrSpiking: candidate.filterResults.atrSpiking ?? false,
    atrSpikeAction: candidate.filterResults.atrSpikeAction ?? null,

    // Scores — not computed in the scan pipeline directly; leave null for now.
    // These will be populated from ScoreBreakdown via backfillScoresOnOutcomes().
    bqs: null,
    fws: null,
    ncs: null,
    rankScore: candidate.rankScore,
    dualScoreAction: null,  // populated during score backfill

    entryTrigger: candidate.entryTrigger,
    stopPrice: candidate.stopPrice,
    distancePct: candidate.distancePercent,
    entryMode: candidate.pullbackSignal?.triggered ? 'PULLBACK_CONTINUATION' : 'BREAKOUT',

    suggestedShares: candidate.shares ?? null,
    suggestedRiskGbp: candidate.riskDollars ?? null,
    suggestedRiskPct: candidate.riskPercent ?? null,
    suggestedCostGbp: candidate.totalCost ?? null,

    antiChaseReason: candidate.antiChaseResult?.reason ?? null,
    earningsAction: candidate.earningsInfo?.action ?? null,
    daysToEarnings: candidate.earningsInfo?.daysUntilEarnings ?? null,

    riskGatesFailed: candidate.riskGateResults
      ?.filter((g) => !g.passed)
      .map((g) => g.gate)
      .join(', ') || null,

    dataFreshness: dataFreshness ?? null,

    tradePlaced: false,
    tradeLogId: null,
    actualFill: null,

    priceAtScan: candidate.price,
    fwdReturn5d: null,
    fwdReturn10d: null,
    fwdReturn20d: null,
    mfeR: null,
    maeR: null,
    reached1R: null,
    reached2R: null,
    reached3R: null,
    stopHit: null,
    enrichedAt: null,
  };
}

// ── Persistence ─────────────────────────────────────────────────────

/**
 * Persist candidate outcome records for a batch of scan candidates.
 * Uses upsert for idempotency — safe to call multiple times per scan.
 * Fire-and-forget: errors are logged, never thrown.
 */
export async function saveCandidateOutcomes(
  candidates: ScanCandidate[],
  scanId: string,
  regime: string,
  dataFreshness?: string | null
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  // Batch upsert in chunks of 25 to stay within SQLite variable limits
  const CHUNK = 25;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    for (const c of chunk) {
      const record = extractCandidateOutcome(c, scanId, regime, dataFreshness);
      try {
        await prisma.candidateOutcome.upsert({
          where: {
            scanId_ticker: { scanId: record.scanId, ticker: record.ticker },
          },
          create: {
            scanId: record.scanId,
            ticker: record.ticker,
            name: record.name,
            sleeve: record.sleeve,
            sector: record.sector,
            cluster: record.cluster,
            status: record.status,
            stageReached: record.stageReached,
            passedTechFilter: record.passedTechFilter,
            passedRiskGates: record.passedRiskGates,
            passedAntiChase: record.passedAntiChase,
            blockedByRegime: record.blockedByRegime,
            blockedReasons: record.blockedReasons,
            regime: record.regime,
            price: record.price,
            ma200: record.ma200,
            adx: record.adx,
            plusDI: record.plusDI,
            minusDI: record.minusDI,
            atrPct: record.atrPct,
            atr: record.atr,
            efficiency: record.efficiency,
            volumeRatio: record.volumeRatio,
            relativeStrength: record.relativeStrength,
            hurstExponent: record.hurstExponent,
            hurstWarn: record.hurstWarn,
            atrSpiking: record.atrSpiking,
            atrSpikeAction: record.atrSpikeAction,
            bqs: record.bqs,
            fws: record.fws,
            ncs: record.ncs,
            rankScore: record.rankScore,
            dualScoreAction: record.dualScoreAction,
            entryTrigger: record.entryTrigger,
            stopPrice: record.stopPrice,
            distancePct: record.distancePct,
            entryMode: record.entryMode,
            suggestedShares: record.suggestedShares,
            suggestedRiskGbp: record.suggestedRiskGbp,
            suggestedRiskPct: record.suggestedRiskPct,
            suggestedCostGbp: record.suggestedCostGbp,
            antiChaseReason: record.antiChaseReason,
            earningsAction: record.earningsAction,
            daysToEarnings: record.daysToEarnings,
            riskGatesFailed: record.riskGatesFailed,
            dataFreshness: record.dataFreshness,
            priceAtScan: record.priceAtScan,
          },
          update: {
            // On re-scan of the same ticker in the same scan run, overwrite
            status: record.status,
            stageReached: record.stageReached,
            passedTechFilter: record.passedTechFilter,
            passedRiskGates: record.passedRiskGates,
            passedAntiChase: record.passedAntiChase,
            blockedByRegime: record.blockedByRegime,
            blockedReasons: record.blockedReasons,
            price: record.price,
            rankScore: record.rankScore,
            suggestedShares: record.suggestedShares,
            suggestedRiskGbp: record.suggestedRiskGbp,
            suggestedRiskPct: record.suggestedRiskPct,
            suggestedCostGbp: record.suggestedCostGbp,
          },
        });
        saved++;
      } catch (e) {
        console.error(`[CandidateOutcome] Upsert failed for ${c.ticker}:`, e);
        errors++;
      }
    }
  }

  return { saved, errors };
}

// ── Trade linkage ───────────────────────────────────────────────────

/**
 * Link a CandidateOutcome row to a placed trade.
 * Called when a trade is executed to mark tradePlaced=true.
 */
export async function linkTradeToOutcome(
  scanId: string,
  ticker: string,
  tradeLogId: string,
  actualFill?: number
): Promise<boolean> {
  try {
    await prisma.candidateOutcome.update({
      where: { scanId_ticker: { scanId, ticker } },
      data: {
        tradePlaced: true,
        tradeLogId,
        actualFill: actualFill ?? null,
      },
    });
    return true;
  } catch {
    return false; // row may not exist if scan predated this feature
  }
}

/**
 * Batch-link closed trades to their CandidateOutcome rows.
 * Matches by ticker + scanDate within ±2 days of trade date.
 */
export async function backfillTradeLinks(): Promise<number> {
  const trades = await prisma.tradeLog.findMany({
    where: {
      decision: { in: ['EXECUTED', 'BUY'] },
    },
    select: {
      id: true,
      ticker: true,
      tradeDate: true,
      actualFill: true,
    },
  });

  let linked = 0;
  for (const trade of trades) {
    const startDate = new Date(trade.tradeDate);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(trade.tradeDate);
    endDate.setDate(endDate.getDate() + 2);

    try {
      const result = await prisma.candidateOutcome.updateMany({
        where: {
          ticker: trade.ticker,
          scanDate: { gte: startDate, lte: endDate },
          tradePlaced: false,
        },
        data: {
          tradePlaced: true,
          tradeLogId: trade.id,
          actualFill: trade.actualFill,
        },
      });
      linked += result.count;
    } catch {
      // Non-critical
    }
  }
  return linked;
}
