/**
 * DEPENDENCIES
 * Consumed by: portfolio-kelly.ts, /api/prediction/kelly-size/route.ts
 * Consumes: kelly-calculator.ts
 * Risk-sensitive: NO — computation only
 * Last modified: 2026-03-07
 * Notes: Discounts Kelly fraction based on prediction uncertainty from
 *        Phases 1 (conformal intervals), 8 (GNN confidence), and 9 (beliefs).
 *        Higher uncertainty → smaller position. Pure math, no DB access.
 *        ⛔ Does NOT modify position-sizer.ts or risk-gates.ts.
 */

// ── Types ────────────────────────────────────────────────────

export interface UncertaintyInputs {
  /** Conformal interval width from Phase 1 (0 = perfect, ~30 = very wide) */
  conformalIntervalWidth: number;
  /** Bayesian belief mean from Phase 9 (0.5 = prior, higher = more trusted) */
  beliefMean: number;
  /** GNN score confidence from Phase 8 (0–1, higher = more confident) */
  gnnConfidence: number;
}

export interface UncertaintyPenalty {
  /** Combined penalty multiplier (0.3–1.0): multiply Kelly fraction by this */
  combinedMultiplier: number;
  /** Individual penalty components for display */
  breakdown: {
    conformalPenalty: number;   // 0–0.3 range
    beliefPenalty: number;     // 0–0.2 range
    gnnPenalty: number;        // 0–0.1 range
  };
}

// ── Constants ────────────────────────────────────────────────

/** Maximum expected conformal interval width for normalisation */
const MAX_EXPECTED_WIDTH = 30;

/** Penalty weights per uncertainty source */
const CONFORMAL_PENALTY_WEIGHT = 0.3;   // up to 30% discount
const BELIEF_PENALTY_WEIGHT = 0.2;      // up to 20% discount
const GNN_PENALTY_WEIGHT = 0.1;         // up to 10% discount

/** Floor: never discount below this multiplier */
const MIN_MULTIPLIER = 0.3;

// ── Computation ──────────────────────────────────────────────

/**
 * Compute the uncertainty penalty that discounts the Kelly fraction.
 * Each uncertainty source contributes an independent discount.
 * Combined multiplier ∈ [0.3, 1.0].
 */
export function computeUncertaintyPenalty(inputs: UncertaintyInputs): UncertaintyPenalty {
  // Conformal penalty: wider interval → bigger penalty
  const conformalRaw = Math.min(inputs.conformalIntervalWidth / MAX_EXPECTED_WIDTH, 1);
  const conformalPenalty = conformalRaw * CONFORMAL_PENALTY_WEIGHT;

  // Belief penalty: belief mean far from 1.0 → less trust → bigger penalty
  // belief=0.5 (prior) → penalty = 0.2 × (1 - 0.5) = 0.1
  // belief=0.8 (trusted) → penalty = 0.2 × (1 - 0.8) = 0.04
  // belief=0.3 (distrusted) → penalty = 0.2 × (1 - 0.3) = 0.14
  const beliefPenalty = (1 - Math.max(0, Math.min(1, inputs.beliefMean))) * BELIEF_PENALTY_WEIGHT;

  // GNN penalty: low confidence → bigger penalty
  const gnnPenalty = (1 - Math.max(0, Math.min(1, inputs.gnnConfidence))) * GNN_PENALTY_WEIGHT;

  // Combined: multiply out the discounts
  const combinedMultiplier = Math.max(
    MIN_MULTIPLIER,
    (1 - conformalPenalty) * (1 - beliefPenalty) * (1 - gnnPenalty)
  );

  return {
    combinedMultiplier: Math.round(combinedMultiplier * 1000) / 1000,
    breakdown: {
      conformalPenalty: Math.round(conformalPenalty * 1000) / 1000,
      beliefPenalty: Math.round(beliefPenalty * 1000) / 1000,
      gnnPenalty: Math.round(gnnPenalty * 1000) / 1000,
    },
  };
}

/**
 * Apply uncertainty penalty to a Kelly fraction.
 */
export function applyUncertaintyPenalty(
  kellyFraction: number,
  penalty: UncertaintyPenalty
): number {
  return Math.max(0, kellyFraction * penalty.combinedMultiplier);
}
