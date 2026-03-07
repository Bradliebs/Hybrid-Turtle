/**
 * DEPENDENCIES
 * Consumed by: signal-weight-meta-model.ts (Phase 3), /api/prediction/beliefs/route.ts
 * Consumes: belief-state.ts
 * Risk-sensitive: NO — read-only weight adjustment computation
 * Last modified: 2026-03-07
 * Notes: Converts current Beta distribution beliefs into weight adjustments
 *        that multiply the Phase 3 meta-model base weights.
 *        Clamped to [0.5×, 2.0×] to prevent runaway suppression.
 *        ⛔ Does NOT modify sacred files.
 */

import {
  getBeliefsByRegime,
  type SignalId,
  type RegimeId,
  type SignalBelief,
  SIGNAL_IDS,
} from './belief-state';

// ── Types ────────────────────────────────────────────────────

export interface BeliefWeightAdjustments {
  regime: RegimeId;
  adjustments: Record<SignalId, number>;  // multiplier per signal (0.5–2.0)
  beliefs: SignalBelief[];
}

// ── Weight Adjustment Logic ──────────────────────────────────

/** Min/max multiplier bounds to prevent runaway suppression or amplification */
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 2.0;

/**
 * Convert belief mean to a weight multiplier.
 * belief.mean = 0.5 (prior) → multiplier = 1.0 (no change)
 * belief.mean = 0.8 (signal works well) → multiplier = 1.6
 * belief.mean = 0.3 (signal works poorly) → multiplier = 0.6
 */
function beliefToMultiplier(belief: SignalBelief): number {
  // multiplier = belief.mean / 0.5, clamped
  const raw = belief.mean / 0.5;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw));
}

/**
 * Get belief-informed weight adjustments for a given regime.
 * Returns multipliers that should be applied to the Phase 3 meta-model weights.
 */
export async function getBeliefWeightAdjustments(regime: RegimeId): Promise<BeliefWeightAdjustments> {
  const beliefs = await getBeliefsByRegime(regime);

  const adjustments = {} as Record<SignalId, number>;
  for (const signal of SIGNAL_IDS) {
    const belief = beliefs.find(b => b.signal === signal);
    if (belief) {
      adjustments[signal] = beliefToMultiplier(belief);
    } else {
      adjustments[signal] = 1.0; // no adjustment if no belief state
    }
  }

  return { regime, adjustments, beliefs };
}

/**
 * Apply belief adjustments to a weight vector.
 * Returns a new weight vector where each weight is multiplied by the
 * belief-informed adjustment, then renormalised to sum to 1.0.
 */
export function applyBeliefAdjustments(
  baseWeights: Record<SignalId, number>,
  adjustments: Record<SignalId, number>
): Record<SignalId, number> {
  const adjusted = {} as Record<SignalId, number>;
  let totalWeight = 0;

  for (const signal of SIGNAL_IDS) {
    const base = baseWeights[signal] ?? 0;
    const mult = adjustments[signal] ?? 1.0;
    adjusted[signal] = base * mult;
    totalWeight += adjusted[signal];
  }

  // Renormalise to sum = 1.0
  if (totalWeight > 0) {
    for (const signal of SIGNAL_IDS) {
      adjusted[signal] = Math.round((adjusted[signal] / totalWeight) * 1000) / 1000;
    }
  }

  return adjusted;
}
