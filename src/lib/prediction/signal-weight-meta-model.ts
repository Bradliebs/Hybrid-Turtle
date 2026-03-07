/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/signal-weights/route.ts, display layer for adjusted NCS
 * Consumes: market-data.ts (VIX fetch), regime-detector.ts (READ ONLY), prisma.ts
 * Risk-sensitive: NO — display-layer reweighting only, never modifies dual-score.ts
 * Last modified: 2026-03-07
 * Notes: Produces dynamic signal weight vectors based on current market context.
 *        Weights are applied as a POST-PROCESSING layer on BQS component outputs.
 *        ⛔ Does NOT modify dual-score.ts or scan-engine.ts — read-only consumer.
 *
 *        The 7 signal groups map to BQS components:
 *          adx      → bqs_trend (0–25)
 *          di       → bqs_direction (0–10)
 *          hurst    → bqs_hurst (0–8)
 *          bis      → bqs_bis (0–15)
 *          drs      → bqs_tailwind (−10 to +20)
 *          weeklyAdx → bqs_weekly_adx (−5 to +10)
 *          bps      → external BPS score (0–19), applied separately
 *
 *        Other BQS components (volatility, proximity, rs, vol_bonus) are
 *        NOT reweighted — they remain at static weight 1.0.
 */

import { getStockQuote, getDailyPrices, getMarketRegime } from '@/lib/market-data';
import { prisma } from '@/lib/prisma';
import type { SignalInvariance } from '@/lib/prediction/causal/invariance-scores';

// ── Types ────────────────────────────────────────────────────

export interface MetaModelContext {
  regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION';
  vixLevel: number;           // raw VIX value
  vixPercentile: number;      // 0–100: where current VIX sits relative to thresholds
  regimeConsecutiveDays: number;
  recentAdx: number;          // market-level ADX (SPY)
}

export interface SignalWeights {
  adx: number;
  di: number;
  hurst: number;
  bis: number;
  drs: number;
  weeklyAdx: number;
  bps: number;
}

export interface SignalWeightResult {
  weights: SignalWeights;
  context: MetaModelContext;
  source: 'rule_based' | 'learned';
  /** Static weight baseline for comparison */
  defaultWeights: SignalWeights;
}

// ── Default (static) weights — approximation of current dual-score.ts ratios ──
// These represent the implicit equal weighting in the current BQS sum.
// Total sums to 1.0 across the 7 reweightable signals.

export const DEFAULT_WEIGHTS: SignalWeights = {
  adx: 0.16,      // bqs_trend: 25-pt range
  di: 0.13,       // bqs_direction: 10-pt range
  hurst: 0.14,    // bqs_hurst: 8-pt range (high info value)
  bis: 0.16,      // bqs_bis: 15-pt range
  drs: 0.17,      // bqs_tailwind: 30-pt range (−10 to +20)
  weeklyAdx: 0.12,// bqs_weekly_adx: 15-pt range (−5 to +10)
  bps: 0.12,      // external BPS: 19-pt range
};

// ── VIX Percentile Mapping ───────────────────────────────────
// Maps raw VIX to a 0–100 percentile based on historical distribution.
// This is a simplified rule-based mapping; could be replaced with
// actual percentile rank from historical VIX data.

function vixToPercentile(vixPrice: number): number {
  if (vixPrice < 12) return 5;
  if (vixPrice < 14) return 15;
  if (vixPrice < 16) return 25;
  if (vixPrice < 18) return 35;
  if (vixPrice < 20) return 50;
  if (vixPrice < 22) return 60;
  if (vixPrice < 25) return 70;
  if (vixPrice < 30) return 80;
  if (vixPrice < 35) return 90;
  return 95;
}

// ── Regime Classification ────────────────────────────────────
// Maps the system's regime + vol regime to the meta-model's 4 categories.

function classifyMetaRegime(
  regime: string,
  vixPercentile: number,
  consecutiveDays: number
): 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION' {
  // High volatility overrides other classifications
  if (vixPercentile > 80) return 'VOLATILE';

  // Short regime history = transitioning
  if (consecutiveDays < 3) return 'TRANSITION';

  if (regime === 'BULLISH') return 'TRENDING';
  if (regime === 'BEARISH') return 'RANGING'; // bearish = mean-reversion signals matter
  return 'RANGING'; // SIDEWAYS/NEUTRAL
}

// ── Rule-Based Weight Selection ──────────────────────────────
// Phase 1: hardcoded regime-dependent weights.
// Phase 2 (future): replaced by learned model when 100+ outcomes available.

function computeRuleBasedWeights(context: MetaModelContext): SignalWeights {
  const { regime, vixPercentile } = context;

  // Trending regime → momentum signals dominate (ADX, DRS lead)
  if (regime === 'TRENDING' && vixPercentile < 60) {
    return { adx: 0.20, di: 0.15, hurst: 0.10, bis: 0.15, drs: 0.20, weeklyAdx: 0.12, bps: 0.08 };
  }

  // Ranging regime → mean-reversion signals (Hurst, BPS) dominate
  if (regime === 'RANGING') {
    return { adx: 0.08, di: 0.08, hurst: 0.30, bis: 0.18, drs: 0.12, weeklyAdx: 0.08, bps: 0.16 };
  }

  // High volatility → breakout quality matters most (BPS + BIS)
  if (regime === 'VOLATILE' || vixPercentile > 80) {
    return { adx: 0.10, di: 0.08, hurst: 0.10, bis: 0.22, drs: 0.12, weeklyAdx: 0.10, bps: 0.28 };
  }

  // Transition → balanced but cautious (weekly ADX + DRS for confirmation)
  if (regime === 'TRANSITION') {
    return { adx: 0.14, di: 0.10, hurst: 0.12, bis: 0.14, drs: 0.20, weeklyAdx: 0.18, bps: 0.12 };
  }

  // Default balanced
  return { ...DEFAULT_WEIGHTS };
}

// ── Context Builder ──────────────────────────────────────────

/**
 * Build the market context vector from live data.
 * Falls back to sensible defaults if data is unavailable.
 */
export async function buildMetaModelContext(): Promise<MetaModelContext> {
  let vixLevel = 20; // default
  let regimeConsecutiveDays = 5; // default: stable
  let marketRegime = 'SIDEWAYS';
  let recentAdx = 25;

  // Fetch VIX
  try {
    const vixQuote = await getStockQuote('^VIX');
    if (vixQuote) {
      vixLevel = vixQuote.price;
    }
  } catch {
    // Use default VIX
  }

  // Fetch regime and stability
  try {
    marketRegime = await getMarketRegime();
  } catch {
    // Use default
  }

  try {
    const latestRegime = await prisma.regimeHistory.findFirst({
      orderBy: { date: 'desc' },
      select: { consecutive: true, adx: true },
    });
    if (latestRegime) {
      regimeConsecutiveDays = latestRegime.consecutive;
      recentAdx = latestRegime.adx ?? 25;
    }
  } catch {
    // Use defaults
  }

  const vixPercentile = vixToPercentile(vixLevel);
  const regime = classifyMetaRegime(marketRegime, vixPercentile, regimeConsecutiveDays);

  return {
    regime,
    vixLevel,
    vixPercentile,
    regimeConsecutiveDays,
    recentAdx,
  };
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Compute the current signal weight vector based on market context.
 * Returns rule-based weights (Phase 1). Learning upgrade added in meta-model-trainer.ts.
 */
export async function computeSignalWeights(): Promise<SignalWeightResult> {
  const context = await buildMetaModelContext();
  let weights = computeRuleBasedWeights(context);

  // Apply invariance penalty: down-weight causally unreliable signals
  weights = await applyInvariancePenalty(weights);

  return {
    weights,
    context,
    source: 'rule_based',
    defaultWeights: { ...DEFAULT_WEIGHTS },
  };
}

// ── Invariance Penalty ───────────────────────────────────────
// Maps signal keys to their InvarianceAuditResult signal names.
// Weights are multiplied by (invarianceScore) so a signal at 0.30
// invariance gets its weight reduced to 30% of its dynamic value.
// Default invarianceScore = 0.75 if no audit has been run (cautiously optimistic).

const SIGNAL_TO_IRM_KEY: Record<keyof SignalWeights, string> = {
  adx: 'bqsTrend',
  di: 'bqsDirection',
  hurst: 'bqsHurst',
  bis: 'bqsBis',
  drs: 'bqsTailwind',
  weeklyAdx: 'bqsWeeklyAdx',
  bps: 'bqsVolBonus', // BPS maps to vol bonus in score breakdown
};

const DEFAULT_INVARIANCE = 0.75;

async function applyInvariancePenalty(weights: SignalWeights): Promise<SignalWeights> {
  let invarianceMap: Record<string, number> = {};

  try {
    const latest = await prisma.invarianceAuditResult.findFirst({
      orderBy: { computedAt: 'desc' },
      select: { scoresJson: true },
    });

    if (latest) {
      const signals = JSON.parse(latest.scoresJson) as SignalInvariance[];
      for (const s of signals) {
        invarianceMap[s.signal] = s.invarianceScore;
      }
    }
  } catch {
    // DB unavailable — use defaults
  }

  const adjusted = { ...weights };

  for (const key of Object.keys(adjusted) as (keyof SignalWeights)[]) {
    const irmKey = SIGNAL_TO_IRM_KEY[key];
    const score = invarianceMap[irmKey] ?? DEFAULT_INVARIANCE;
    const originalWeight = adjusted[key];
    adjusted[key] = originalWeight * score;

    if (score < DEFAULT_INVARIANCE) {
      console.log(`[meta-model] Invariance penalty: ${key} weight ${originalWeight.toFixed(3)} × ${score.toFixed(3)} → ${adjusted[key].toFixed(3)}`);
    }
  }

  // Re-normalise so weights sum to ~1.0
  const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const key of Object.keys(adjusted) as (keyof SignalWeights)[]) {
      adjusted[key] = adjusted[key] / total;
    }
  }

  return adjusted;
}

// ── Adjusted NCS Computation ─────────────────────────────────

export interface BQSComponents {
  bqs_trend: number;
  bqs_direction: number;
  bqs_volatility: number;
  bqs_proximity: number;
  bqs_tailwind: number;
  bqs_rs: number;
  bqs_vol_bonus: number;
  bqs_weekly_adx: number;
  bqs_bis: number;
  bqs_hurst: number;
  BQS: number;
}

/**
 * Compute adjusted BQS by applying meta-model weights to signal components.
 * Non-reweighted components (volatility, proximity, rs, vol_bonus) pass through at 1.0.
 *
 * The reweighting normalizes each component by its max range, applies the weight,
 * then scales back up so the total remains in the BQS 0–100 range.
 */
export function computeAdjustedBQS(
  bqs: BQSComponents,
  weights: SignalWeights,
  bps: number = 0
): { adjustedBQS: number; rawBQS: number } {
  // Signal ranges (max achievable values) for normalization
  const ranges = {
    adx: 25,       // bqs_trend
    di: 10,        // bqs_direction
    hurst: 8,      // bqs_hurst
    bis: 15,       // bqs_bis
    drs: 30,       // bqs_tailwind (−10 to +20 → 30 range)
    weeklyAdx: 15, // bqs_weekly_adx (−5 to +10 → 15 range)
    bps: 19,       // external BPS
  };

  // Normalize each signal to 0–1, apply weight, then sum
  const reweightedSignals =
    (weights.adx * (bqs.bqs_trend / ranges.adx)) +
    (weights.di * (bqs.bqs_direction / ranges.di)) +
    (weights.hurst * (bqs.bqs_hurst / ranges.hurst)) +
    (weights.bis * (bqs.bqs_bis / ranges.bis)) +
    // DRS: shift from −10..+20 to 0..30 before normalizing
    (weights.drs * ((bqs.bqs_tailwind + 10) / ranges.drs)) +
    // Weekly ADX: shift from −5..+10 to 0..15 before normalizing
    (weights.weeklyAdx * ((bqs.bqs_weekly_adx + 5) / ranges.weeklyAdx)) +
    (weights.bps * (bps / ranges.bps));

  // Scale back to BQS range: the reweightable signals make up ~76 of the
  // theoretical 100-point max BQS. Non-reweighted components add the rest.
  const reweightableMax = 76; // sum of all signal ranges minus volatility/proximity/rs/volBonus
  const staticComponents = bqs.bqs_volatility + bqs.bqs_proximity + bqs.bqs_rs + bqs.bqs_vol_bonus;

  const adjustedBQS = Math.max(0, Math.min(100,
    reweightedSignals * reweightableMax + staticComponents
  ));

  return {
    adjustedBQS: Math.round(adjustedBQS * 100) / 100,
    rawBQS: bqs.BQS,
  };
}

/**
 * Compute adjusted NCS from adjusted BQS + FWS + penalties.
 * Mirrors the dual-score.ts NCS formula but with reweighted BQS.
 */
export function computeAdjustedNCS(
  adjustedBQS: number,
  fws: number,
  totalPenalty: number
): { adjustedNCS: number } {
  const baseNCS = Math.max(0, Math.min(100, adjustedBQS - 0.8 * fws + 10));
  const adjustedNCS = Math.max(0, Math.min(100, baseNCS - Math.min(totalPenalty, 40)));
  return { adjustedNCS: Math.round(adjustedNCS * 100) / 100 };
}
