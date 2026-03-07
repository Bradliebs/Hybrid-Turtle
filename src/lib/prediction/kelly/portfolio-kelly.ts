/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/kelly-size/route.ts, KellySizePanel
 * Consumes: kelly-calculator.ts, uncertainty-penalty.ts
 * Risk-sensitive: NO — advisory computation only
 * Last modified: 2026-03-07
 * Notes: Multi-position Kelly with correlation adjustment.
 *        Individual Kelly fractions scaled down for correlated positions.
 *        Output respects the profile's max risk per trade cap.
 *        ⛔ Does NOT modify position-sizer.ts or risk-gates.ts.
 */

import {
  computeKelly,
  estimateWinProbability,
  type KellyInput,
  type KellyResult,
} from './kelly-calculator';
import {
  computeUncertaintyPenalty,
  applyUncertaintyPenalty,
  type UncertaintyInputs,
  type UncertaintyPenalty,
} from './uncertainty-penalty';

// ── Types ────────────────────────────────────────────────────

export interface PortfolioKellyInput {
  /** NCS score (0–100) */
  ncs: number;
  /** Historical base win rate (e.g. 0.45) */
  baseWinRate: number;
  /** Average winner R-multiple */
  avgWinR: number;
  /** Average loser R-multiple magnitude */
  avgLossR: number;
  /** Uncertainty inputs from prediction stack */
  uncertainty: UncertaintyInputs;
  /** Average correlation with existing open positions (0–1) */
  avgCorrelationWithPortfolio: number;
  /** Profile max risk per trade (e.g. 2.0 for SMALL_ACCOUNT) */
  maxRiskPerTrade: number;
}

export interface PortfolioKellyResult {
  /** Raw Kelly result before penalties */
  rawKelly: KellyResult;
  /** Uncertainty penalty breakdown */
  uncertaintyPenalty: UncertaintyPenalty;
  /** Kelly fraction after uncertainty penalty */
  uncertaintyAdjustedFraction: number;
  /** Kelly fraction after correlation adjustment */
  correlationAdjustedFraction: number;
  /** Final suggested risk % (capped by profile max) */
  suggestedRiskPercent: number;
  /** What the profile's fixed risk % would be (for comparison) */
  profileFixedRisk: number;
  /** Ratio: Kelly suggestion / profile fixed (< 1 = Kelly says smaller, > 1 = Kelly says larger) */
  kellyVsFixed: number;
}

// ── Portfolio Kelly Computation ──────────────────────────────

/**
 * Full portfolio-aware Kelly computation:
 * 1. Estimate win probability from NCS + base win rate
 * 2. Compute standard Kelly
 * 3. Apply quarter-Kelly fraction
 * 4. Discount by uncertainty penalties
 * 5. Adjust for portfolio correlation
 * 6. Cap at profile max risk per trade
 */
export function computePortfolioKelly(input: PortfolioKellyInput): PortfolioKellyResult {
  // Step 1: Win probability from NCS
  const winProb = estimateWinProbability(input.baseWinRate, input.ncs / 100);

  // Step 2-3: Compute Kelly + quarter fraction
  const kellyInput: KellyInput = {
    winProbability: winProb,
    avgWinR: input.avgWinR,
    avgLossR: input.avgLossR,
  };
  const rawKelly = computeKelly(kellyInput);

  // Step 4: Apply uncertainty penalty
  const penalty = computeUncertaintyPenalty(input.uncertainty);
  const uncertaintyAdjusted = applyUncertaintyPenalty(rawKelly.quarterKelly, penalty);

  // Step 5: Correlation adjustment
  // Scale down when correlated positions exist to prevent over-concentration
  const corrFactor = 1 - input.avgCorrelationWithPortfolio * 0.5;
  const correlationAdjusted = uncertaintyAdjusted * Math.max(0.3, corrFactor);

  // Step 6: Convert to risk % and cap
  const suggestedRiskPct = Math.min(
    correlationAdjusted * 100,
    input.maxRiskPerTrade
  );

  // Comparison with fixed risk
  const kellyVsFixed = input.maxRiskPerTrade > 0
    ? suggestedRiskPct / input.maxRiskPerTrade
    : 1;

  return {
    rawKelly,
    uncertaintyPenalty: penalty,
    uncertaintyAdjustedFraction: Math.round(uncertaintyAdjusted * 10000) / 10000,
    correlationAdjustedFraction: Math.round(correlationAdjusted * 10000) / 10000,
    suggestedRiskPercent: Math.round(suggestedRiskPct * 100) / 100,
    profileFixedRisk: input.maxRiskPerTrade,
    kellyVsFixed: Math.round(kellyVsFixed * 100) / 100,
  };
}
