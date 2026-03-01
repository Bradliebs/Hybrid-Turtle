/**
 * DEPENDENCIES
 * Consumed by: BuyConfirmationModal.tsx (client-side), /api/risk/correlation-scalar/route.ts
 * Consumes: nothing (pure function — no DB, no server-only imports)
 * Risk-sensitive: YES (reduces position size based on correlation)
 * Last modified: 2026-03-01
 * Notes: Applies a size reduction scalar when a new candidate is highly correlated
 *        with an existing open position. Protects against "hidden leverage" where
 *        cluster caps pass but correlation creates effective overexposure.
 *
 *        Scalar tiers:
 *          r < 0.75   → 1.00 (full size)
 *          r 0.75–0.85 → 0.75 (reduce 25%)
 *          r 0.85–0.93 → 0.50 (reduce 50%)
 *          r > 0.93   → 0.25 (reduce 75%)
 *
 *        Applied AFTER position-sizer.ts output — never modifies position-sizer internals.
 */

export interface CorrelationWarning {
  ticker: string;
  correlation: number;
}

export interface CorrelationScalarResult {
  /** Multiplicative scalar to apply to base share count (1.0 = no reduction) */
  scalar: number;
  /** Human-readable reason for display in BuyConfirmationModal, or null if no reduction */
  reason: string | null;
  /** The most-correlated open ticker, or null if no reduction */
  correlatedTicker: string | null;
  /** The highest correlation value found, or null if no data */
  maxCorrelation: number | null;
}

// ── Scalar Tier Thresholds ───────────────────────────────────
// Boundaries chosen based on portfolio diversification theory:
//   0.75 = moderately correlated — slight reduction
//   0.85 = highly correlated — halve the position
//   0.93 = near-identical — reduce to quarter size

const TIERS: { minR: number; scalar: number; label: string }[] = [
  { minR: 0.93, scalar: 0.25, label: 'reduced by 75%' },
  { minR: 0.85, scalar: 0.50, label: 'reduced by 50%' },
  { minR: 0.75, scalar: 0.75, label: 'reduced by 25%' },
];

/**
 * Determine the position size scalar based on correlation between
 * a candidate ticker and all open positions.
 *
 * @param warnings - Correlation warnings from checkCorrelationWarnings()
 *                   (pairs where r > 0.75 involving the candidate and open positions)
 * @returns scalar result with multiplier and reason string
 *
 * Fail-safe: if no correlation data exists, returns scalar = 1.0 (no reduction).
 */
export function getCorrelationScalar(
  warnings: CorrelationWarning[]
): CorrelationScalarResult {
  if (warnings.length === 0) {
    return { scalar: 1.0, reason: null, correlatedTicker: null, maxCorrelation: null };
  }

  // Find the highest correlation among all warnings
  let maxWarning = warnings[0];
  for (const w of warnings) {
    if (w.correlation > maxWarning.correlation) {
      maxWarning = w;
    }
  }

  const r = maxWarning.correlation;

  // Walk tiers from strictest to least strict
  for (const tier of TIERS) {
    if (r >= tier.minR) {
      const pct = Math.round(r * 100);
      return {
        scalar: tier.scalar,
        reason: `${pct}% correlated with ${maxWarning.ticker} — position ${tier.label}`,
        correlatedTicker: maxWarning.ticker,
        maxCorrelation: r,
      };
    }
  }

  // r > 0.75 but below 0.75 tier minimum — shouldn't happen given checkCorrelationWarnings
  // returns only r > 0.75, but handle gracefully
  return { scalar: 1.0, reason: null, correlatedTicker: null, maxCorrelation: r };
}

/**
 * Apply the correlation scalar to a base share count.
 * Uses Trading 212-compatible floor to 0.01 shares.
 */
export function applyCorrelationScalar(
  baseShares: number,
  scalar: number
): number {
  if (scalar >= 1.0) return baseShares;
  // Floor to 0.01 (T212 fractional precision) — never round up
  return Math.floor(baseShares * scalar * 100) / 100;
}
