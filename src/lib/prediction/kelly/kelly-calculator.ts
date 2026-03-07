/**
 * DEPENDENCIES
 * Consumed by: portfolio-kelly.ts, /api/prediction/kelly-size/route.ts
 * Consumes: (standalone — pure math)
 * Risk-sensitive: NO — advisory sizing SUGGESTION only, never overrides position-sizer.ts
 * Last modified: 2026-03-07
 * Notes: Standard Kelly Criterion computation + fractional Kelly (quarter-Kelly).
 *        Output is a SUGGESTION that feeds the position sizer as an input.
 *        Hard caps from risk-gates.ts always prevail.
 *        ⛔ Does NOT modify position-sizer.ts or risk-gates.ts.
 */

// ── Types ────────────────────────────────────────────────────

export interface KellyInput {
  /** Estimated probability of winning (0–1) */
  winProbability: number;
  /** Average winner R-multiple (e.g. 2.5) */
  avgWinR: number;
  /** Average loser R-multiple magnitude (e.g. 1.0, always positive) */
  avgLossR: number;
}

export interface KellyResult {
  /** Raw full Kelly fraction (can be > 1.0 for edge cases) */
  fullKelly: number;
  /** Quarter-Kelly (25% of full) — recommended fraction */
  quarterKelly: number;
  /** Kelly suggests this % of equity to risk */
  suggestedRiskPercent: number;
  /** Edge: expected value per unit risked */
  edge: number;
  /** Whether Kelly suggests a positive bet (edge > 0) */
  hasEdge: boolean;
}

// ── Kelly Computation ────────────────────────────────────────

/**
 * Standard Kelly Criterion:
 *   f* = (p × b - q) / b
 * where:
 *   p = probability of winning
 *   b = win/loss ratio (avgWinR / avgLossR)
 *   q = 1 - p (probability of losing)
 *
 * Returns the optimal fraction of bankroll to wager.
 */
export function computeKelly(input: KellyInput): KellyResult {
  const { winProbability, avgWinR, avgLossR } = input;

  // Validate inputs
  const p = Math.max(0, Math.min(1, winProbability));
  const q = 1 - p;
  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;

  // Edge = expected value per unit risked
  const edge = p * b - q;

  // Full Kelly fraction
  const fullKelly = b > 0 ? (p * b - q) / b : 0;

  // Quarter-Kelly: ~80% of Kelly's growth rate with dramatically lower drawdowns
  const quarterKelly = Math.max(0, fullKelly * 0.25);

  // Convert to risk percentage (capped at reasonable bounds)
  const suggestedRiskPercent = Math.max(0, Math.min(5, quarterKelly * 100));

  return {
    fullKelly: Math.round(fullKelly * 10000) / 10000,
    quarterKelly: Math.round(quarterKelly * 10000) / 10000,
    suggestedRiskPercent: Math.round(suggestedRiskPercent * 100) / 100,
    edge: Math.round(edge * 10000) / 10000,
    hasEdge: edge > 0,
  };
}

/**
 * Compute win probability from NCS percentile and historical win rate.
 * NCS acts as a quality multiplier on the base win rate.
 *
 * @param baseWinRate - Historical win rate (e.g. 0.45)
 * @param ncsPercentile - NCS score normalised to 0–1 (NCS/100)
 * @returns Adjusted win probability in [0.1, 0.9]
 */
export function estimateWinProbability(baseWinRate: number, ncsPercentile: number): number {
  // NCS multiplier: high NCS → boost win probability, low → reduce
  // At ncsPercentile=0.5 → no adjustment (multiplier=1.0)
  // At ncsPercentile=0.8 → multiplier ≈ 1.3
  // At ncsPercentile=0.3 → multiplier ≈ 0.7
  const multiplier = 0.4 + ncsPercentile * 1.2;

  const adjusted = baseWinRate * multiplier;
  return Math.max(0.1, Math.min(0.9, adjusted));
}
