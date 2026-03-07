/**
 * DEPENDENCIES
 * Consumed by: conformal-store.ts, bootstrap-calibration.ts, /api/prediction/interval/route.ts
 * Consumes: (standalone — pure math, no internal imports)
 * Risk-sensitive: NO — post-processing layer on NCS scores, never modifies signals
 * Last modified: 2026-03-07
 * Notes: Core conformal prediction logic. Wraps NCS point scores in statistically
 *        calibrated prediction intervals with coverage guarantees.
 *        ⛔ Does NOT modify dual-score.ts or scan-engine.ts — read-only consumer.
 */

// ── Types ────────────────────────────────────────────────────

export interface ConformalInterval {
  point: number;        // raw NCS score
  lower: number;        // lower bound of interval
  upper: number;        // upper bound of interval
  width: number;        // interval width (qHatUp + qHatDown)
  coverageLevel: number; // e.g. 0.90
}

export interface ConformalDecision {
  decision: 'AUTO_YES' | 'AUTO_NO' | 'CONDITIONAL';
  /** Reason string when decision differs from naive point-score classification */
  reason?: string;
}

export interface ConformalThresholds {
  autoYes: number;      // NCS threshold for Auto-Yes (default: 70)
  autoNo: number;       // NCS threshold for Auto-No (default: 30 — below this is reject)
  maxFWS: number;       // FWS cap for Auto-Yes (default: 30)
}

export const DEFAULT_CONFORMAL_THRESHOLDS: ConformalThresholds = {
  autoYes: 70,
  autoNo: 30,
  maxFWS: 30,
};

export type IntervalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

// ── Core Math ────────────────────────────────────────────────

/**
 * Compute the conformal quantile threshold (q̂) from calibration residuals.
 * Uses the split conformal prediction formula: take the ⌈(n+1)×α⌉-th
 * smallest absolute residual as the symmetric quantile.
 */
export function computeQHat(residuals: number[], coverage: number): number {
  if (residuals.length === 0) return Infinity;
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = Math.ceil((n + 1) * coverage) - 1;
  return sorted[Math.min(idx, n - 1)];
}

/**
 * Compute asymmetric quantiles — upside and downside separately.
 * Useful when NCS prediction errors are skewed (overestimates vs underestimates).
 */
export function computeAsymmetricQHats(
  residuals: number[],
  coverage: number
): { qHatUp: number; qHatDown: number } {
  if (residuals.length === 0) return { qHatUp: Infinity, qHatDown: Infinity };

  // Upside residuals: predicted too LOW → actual was higher (positive residual)
  const upsideResiduals = residuals.filter(r => r >= 0).sort((a, b) => a - b);
  // Downside residuals: predicted too HIGH → actual was lower (negative, take abs)
  const downsideResiduals = residuals.filter(r => r < 0).map(r => Math.abs(r)).sort((a, b) => a - b);

  const computeQ = (sorted: number[]): number => {
    if (sorted.length === 0) return 0;
    const n = sorted.length;
    const idx = Math.ceil((n + 1) * coverage) - 1;
    return sorted[Math.min(idx, n - 1)];
  };

  return {
    qHatUp: computeQ(upsideResiduals),
    qHatDown: computeQ(downsideResiduals),
  };
}

// ── Interval Construction ────────────────────────────────────

/**
 * Wrap an NCS point score in a prediction interval using pre-computed quantiles.
 */
export function getInterval(
  ncs: number,
  qHatUp: number,
  qHatDown: number,
  coverageLevel: number
): ConformalInterval {
  return {
    point: ncs,
    lower: Math.max(0, ncs - qHatDown),
    upper: Math.min(100, ncs + qHatUp),
    width: qHatUp + qHatDown,
    coverageLevel,
  };
}

// ── Decision Logic ───────────────────────────────────────────

/**
 * Make a conformal-aware trade decision using the prediction interval.
 * Key principle: Auto-Yes only fires if the PESSIMISTIC (lower) bound clears the bar.
 * This prevents overconfident trades when NCS uncertainty is high.
 */
export function getConformalDecision(
  interval: ConformalInterval,
  fws: number,
  thresholds: ConformalThresholds = DEFAULT_CONFORMAL_THRESHOLDS
): ConformalDecision {
  // FWS still blocks regardless of NCS interval
  if (fws > 65) {
    return { decision: 'AUTO_NO', reason: `FWS ${Math.round(fws)} > 65 (fragile)` };
  }

  // Pessimistic estimate clears the auto-yes bar
  if (interval.lower >= thresholds.autoYes && fws <= thresholds.maxFWS) {
    return { decision: 'AUTO_YES' };
  }

  // Even the optimistic estimate fails
  if (interval.upper < thresholds.autoNo) {
    return { decision: 'AUTO_NO', reason: `Upper bound ${interval.upper.toFixed(1)} < ${thresholds.autoNo}` };
  }

  // Point score clears but lower bound doesn't — uncertain
  if (interval.point >= thresholds.autoYes && fws <= thresholds.maxFWS) {
    return {
      decision: 'CONDITIONAL',
      reason: `NCS ${interval.point.toFixed(1)} clears ${thresholds.autoYes} but lower bound ${interval.lower.toFixed(1)} does not — high uncertainty`,
    };
  }

  return { decision: 'CONDITIONAL' };
}

// ── Confidence Classification ────────────────────────────────

/**
 * Classify interval width into a confidence band.
 * Narrow → high conviction, Wide → uncertain.
 */
export function classifyConfidence(width: number): IntervalConfidence {
  if (width < 8) return 'HIGH';
  if (width <= 15) return 'MEDIUM';
  return 'LOW';
}
