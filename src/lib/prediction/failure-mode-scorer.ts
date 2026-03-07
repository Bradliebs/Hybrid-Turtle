/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/failure-modes/route.ts, FailureModePanel.tsx
 * Consumes: failure-mode-thresholds.ts, earnings-calendar.ts, correlation-matrix.ts
 *           regime-detector.ts (READ ONLY), dual-score.ts (READ ONLY)
 * Risk-sensitive: NO — advisory scoring, no position changes
 * Last modified: 2026-03-07
 * Notes: Computes 5 independent failure mode scores for a candidate trade.
 *        Each FM tests a specific failure mechanism. A trade is rejected if
 *        ANY single FM exceeds its threshold — aircraft safety logic.
 *        ⛔ Does NOT modify sacred files. Reads regime/correlation data only.
 */

import type { TechnicalData, Sleeve } from '@/types';
import { getEarningsInfo } from '@/lib/earnings-calendar';
import { checkCorrelationWarnings } from '@/lib/correlation-matrix';
import type {
  FMScores,
  FailureModeId,
  FailureModeGateResult,
} from './failure-mode-thresholds';
import { failureModeGate } from './failure-mode-thresholds';
import { prisma } from '@/lib/prisma';

// ── Input Types ──────────────────────────────────────────────

export interface FMCandidateInput {
  ticker: string;
  price: number;
  entryTrigger: number;
  stopPrice: number;
  technicals: TechnicalData;
  sleeve: Sleeve;
  sector?: string;
  cluster?: string;
}

export interface FMPortfolioContext {
  /** Tickers of currently open positions */
  openTickers: string[];
  /** Sectors of currently open positions (for sector concentration check) */
  openSectors: string[];
  /** Clusters of currently open positions */
  openClusters: string[];
}

export interface FMScorerResult {
  scores: FMScores;
  gate: FailureModeGateResult;
  reasons: Record<FailureModeId, string>;
}

// ── Helpers ──────────────────────────────────────────────────

function clamp(x: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

// ── FM1: Breakout Failure Risk ───────────────────────────────
// Probability of false break / immediate reversal.
// Inputs: volume ratio, ADX strength, BIS score, proximity to high,
//         failed breakout history.

function computeFM1(candidate: FMCandidateInput): { score: number; reason: string } {
  const { technicals, price, entryTrigger } = candidate;

  // Factor 1: Volume on breakout day vs 20d average (< 1.2x = weak breakout)
  // Low volume breakouts fail more often
  const volRatio = technicals.volumeRatio;
  const volumeFactor = volRatio < 1.0 ? 25 : volRatio < 1.2 ? 15 : volRatio < 1.5 ? 5 : 0;

  // Factor 2: ADX strength (lower ADX = weaker trend = higher failure risk)
  const adx = technicals.adx;
  const adxFactor = clamp((1 - adx / 50), 0, 1) * 20;

  // Factor 3: BIS (Breakout Integrity Score) — low BIS = poor candle structure
  const bis = technicals.bis ?? 7.5; // default mid-range if unavailable
  // BIS range is 0–15; below 5 is poor, above 10 is strong
  const bisFactor = bis < 3 ? 20 : bis < 5 ? 12 : bis < 8 ? 5 : 0;

  // Factor 4: Distance from trigger — if price is right at the ceiling, reversal is more likely
  const distToTrigger = entryTrigger > 0 ? ((price - entryTrigger) / entryTrigger) * 100 : 0;
  // Price AT or ABOVE trigger but barely (within 0.5%) = high risk
  const proximityFactor = distToTrigger >= 0 && distToTrigger < 0.5 ? 15 :
                          distToTrigger >= 0.5 && distToTrigger < 1.0 ? 8 : 0;

  // Factor 5: Prior failed breakout on this ticker (failedBreakoutAt set)
  const hasRecentFailure = technicals.failedBreakoutAt !== null;
  const failureHistoryFactor = hasRecentFailure ? 15 : 0;

  const reasons: string[] = [];
  if (volumeFactor > 10) reasons.push(`weak volume (${volRatio.toFixed(1)}x)`);
  if (adxFactor > 10) reasons.push(`weak ADX (${adx.toFixed(0)})`);
  if (bisFactor > 10) reasons.push(`poor BIS (${bis.toFixed(0)})`);
  if (proximityFactor > 0) reasons.push('at breakout ceiling');
  if (hasRecentFailure) reasons.push('prior failed breakout');

  const score = clamp(volumeFactor + adxFactor + bisFactor + proximityFactor + failureHistoryFactor);

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'Low breakout failure risk',
  };
}

// ── FM2: Liquidity Trap Risk ─────────────────────────────────
// Volume drying up post-entry; inability to exit cleanly.
// Inputs: average daily volume, ATR%, volume ratio, sleeve type.

function computeFM2(candidate: FMCandidateInput): { score: number; reason: string } {
  const { technicals, sleeve } = candidate;

  // Factor 1: Volume ratio — currently low volume relative to average
  const volRatio = technicals.volumeRatio;
  const lowVolumeFactor = volRatio < 0.5 ? 35 : volRatio < 0.8 ? 20 : volRatio < 1.0 ? 8 : 0;

  // Factor 2: ATR% as proxy for spread/liquidity — high ATR% = wide moves = thin book
  const atrPct = technicals.atrPercent;
  const spreadFactor = atrPct > 6 ? 25 : atrPct > 4 ? 15 : atrPct > 3 ? 5 : 0;

  // Factor 3: Sleeve type — HIGH_RISK tickers are typically less liquid
  const sleeveFactor = sleeve === 'HIGH_RISK' ? 20 : sleeve === 'ETF' ? 0 : 5;

  // Factor 4: Low efficiency — choppy, illiquid stocks have low efficiency
  const efficiency = technicals.efficiency;
  const efficiencyFactor = efficiency < 20 ? 15 : efficiency < 30 ? 8 : 0;

  const reasons: string[] = [];
  if (lowVolumeFactor > 15) reasons.push(`low volume (${volRatio.toFixed(1)}x avg)`);
  if (spreadFactor > 10) reasons.push(`wide ATR% (${atrPct.toFixed(1)}%)`);
  if (sleeveFactor >= 20) reasons.push('HIGH_RISK sleeve');
  if (efficiencyFactor > 10) reasons.push(`choppy (eff ${efficiency.toFixed(0)}%)`);

  const score = clamp(lowVolumeFactor + spreadFactor + sleeveFactor + efficiencyFactor);

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'Good liquidity',
  };
}

// ── FM3: Correlation Cascade Risk ────────────────────────────
// Portfolio correlation concentration; forced exit contagion.
// Uses pre-computed correlation flags from nightly pipeline.

async function computeFM3(
  candidate: FMCandidateInput,
  context: FMPortfolioContext
): Promise<{ score: number; reason: string }> {
  if (context.openTickers.length === 0) {
    return { score: 0, reason: 'No open positions (no correlation risk)' };
  }

  // Get correlation warnings from nightly-computed correlation matrix
  const warnings = await checkCorrelationWarnings(candidate.ticker, context.openTickers);

  if (warnings.length === 0) {
    // Also check cluster/sector overlap as a softer signal
    const sameCluster = candidate.cluster && context.openClusters.includes(candidate.cluster);
    const sameSector = candidate.sector && context.openSectors.includes(candidate.sector);

    const clusterFactor = sameCluster ? 20 : 0;
    const sectorFactor = sameSector ? 15 : 0;
    const score = clamp(clusterFactor + sectorFactor);

    const reasons: string[] = [];
    if (sameCluster) reasons.push(`same cluster (${candidate.cluster})`);
    if (sameSector) reasons.push(`same sector (${candidate.sector})`);

    return {
      score,
      reason: reasons.length > 0 ? reasons.join('; ') : 'No significant correlation',
    };
  }

  // Use max pairwise correlation as the primary signal
  const maxCorr = Math.max(...warnings.map(w => w.correlation));
  const maxCorrTicker = warnings.find(w => w.correlation === maxCorr)!.ticker;

  // Map correlation to score: r=0.75→50, r=0.85→70, r=0.93→90, r=1.0→100
  const corrScore = clamp((maxCorr - 0.5) * 200); // 0.75→50, 0.85→70, 0.95→90

  // Additional factor: number of correlated positions amplifies the risk
  const countFactor = warnings.length > 2 ? 15 : warnings.length > 1 ? 8 : 0;

  const score = clamp(corrScore + countFactor);

  return {
    score,
    reason: `r=${maxCorr.toFixed(2)} with ${maxCorrTicker}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}`,
  };
}

// ── FM4: Regime Flip Risk ────────────────────────────────────
// Trend environment collapses mid-trade.
// Uses regime stability data from RegimeHistory table.

async function computeFM4(candidate: FMCandidateInput): Promise<{ score: number; reason: string }> {
  const { technicals } = candidate;

  // Factor 1: Get regime stability from recent history
  let consecutiveDays = 3; // default: assume stable
  try {
    const latestRegime = await prisma.regimeHistory.findFirst({
      orderBy: { date: 'desc' },
      select: { regime: true, consecutive: true, adx: true },
    });
    if (latestRegime) {
      consecutiveDays = latestRegime.consecutive;
    }
  } catch {
    // DB unavailable; use default
  }

  // Low consecutive days = regime just changed = unstable
  const stabilityFactor = consecutiveDays < 2 ? 35 :
                          consecutiveDays < 3 ? 25 :
                          consecutiveDays < 5 ? 10 : 0;

  // Factor 2: ADX slope — if ADX is declining, trend is weakening
  // We use the delta between current ATR and 20-day-ago ATR as a proxy for momentum decay
  const atrNow = technicals.atr;
  const atr20Ago = technicals.atr20DayAgo;
  const atrRatio = atr20Ago > 0 ? atrNow / atr20Ago : 1;
  // Rising ATR with falling ADX can signal regime transition
  const adxDecayFactor = technicals.adx < 25 ? 15 : technicals.adx < 30 ? 8 : 0;

  // Factor 3: ATR spiking — volatility expansion often precedes regime flip
  const spikesFactor = technicals.atrSpiking ? 20 : 0;

  // Factor 4: DI spread narrowing — trend losing directional conviction
  const diSpread = technicals.plusDI - technicals.minusDI;
  const diNarrowFactor = diSpread < 5 ? 20 : diSpread < 10 ? 10 : diSpread < 15 ? 3 : 0;

  const reasons: string[] = [];
  if (stabilityFactor > 15) reasons.push(`regime unstable (${consecutiveDays}d consecutive)`);
  if (adxDecayFactor > 10) reasons.push(`weak ADX (${technicals.adx.toFixed(0)})`);
  if (spikesFactor > 0) reasons.push('ATR spiking');
  if (diNarrowFactor > 10) reasons.push(`DI spread narrow (${diSpread.toFixed(1)})`);

  const score = clamp(stabilityFactor + adxDecayFactor + spikesFactor + diNarrowFactor);

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'Regime stable',
  };
}

// ── FM5: Event Gap Risk ──────────────────────────────────────
// Known earnings / macro event within stop distance.
// Uses EarningsCache via earnings-calendar.ts.

async function computeFM5(candidate: FMCandidateInput): Promise<{ score: number; reason: string }> {
  // Factor 1: Days to earnings
  let daysToEarnings: number | null = null;
  try {
    const earningsInfo = await getEarningsInfo(candidate.ticker);
    daysToEarnings = earningsInfo.daysUntilEarnings;
  } catch {
    // Earnings data unavailable — don't penalise
  }

  let earningsFactor = 0;
  if (daysToEarnings !== null) {
    if (daysToEarnings < 3) {
      earningsFactor = 55; // Imminent earnings — near-guaranteed gap risk
    } else if (daysToEarnings < 7) {
      earningsFactor = 30; // Hard bump for within-week earnings
    } else if (daysToEarnings < 14) {
      earningsFactor = (14 - daysToEarnings) * 3; // Linear scale: 3 pts/day for 7-14d
    }
  }

  // Factor 2: Stop distance as % of price — tight stops are more vulnerable to event gaps
  const stopDistance = Math.abs(candidate.price - candidate.stopPrice);
  const stopPct = candidate.price > 0 ? (stopDistance / candidate.price) * 100 : 0;
  // Very tight stop (< 3% of price) + earnings = disaster
  const tightStopFactor = (daysToEarnings !== null && daysToEarnings < 14 && stopPct < 3) ? 15 :
                          (daysToEarnings !== null && daysToEarnings < 14 && stopPct < 5) ? 8 : 0;

  // Factor 3: ATR spiking near an event amplifies gap risk
  const volEventFactor = (daysToEarnings !== null && daysToEarnings < 7 && candidate.technicals.atrSpiking) ? 10 : 0;

  const reasons: string[] = [];
  if (daysToEarnings !== null && daysToEarnings < 14) {
    reasons.push(`earnings in ${daysToEarnings}d`);
  }
  if (tightStopFactor > 0) reasons.push(`tight stop (${stopPct.toFixed(1)}%)`);
  if (volEventFactor > 0) reasons.push('vol spiking near event');

  const score = clamp(earningsFactor + tightStopFactor + volEventFactor);

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'No imminent events',
  };
}

// ── Main Scorer ──────────────────────────────────────────────

/**
 * Compute all 5 failure mode scores for a candidate trade.
 * FM3 and FM4 are async (DB queries for correlation and regime data).
 */
export async function computeFailureModes(
  candidate: FMCandidateInput,
  context: FMPortfolioContext
): Promise<FMScorerResult> {
  // Run all 5 FMs — FM1 and FM2 are sync, FM3-5 are async
  const fm1 = computeFM1(candidate);
  const fm2 = computeFM2(candidate);
  const [fm3, fm4, fm5] = await Promise.all([
    computeFM3(candidate, context),
    computeFM4(candidate),
    computeFM5(candidate),
  ]);

  const scores: FMScores = {
    fm1: fm1.score,
    fm2: fm2.score,
    fm3: fm3.score,
    fm4: fm4.score,
    fm5: fm5.score,
  };

  const reasons: Record<FailureModeId, string> = {
    fm1: fm1.reason,
    fm2: fm2.reason,
    fm3: fm3.reason,
    fm4: fm4.reason,
    fm5: fm5.reason,
  };

  const gate = failureModeGate(scores, reasons);

  return { scores, gate, reasons };
}
