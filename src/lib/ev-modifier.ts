/**
 * DEPENDENCIES
 * Consumed by: /api/ev-modifiers/route.ts, TodayPanel.tsx (via API)
 * Consumes: ev-tracker.ts (ExpectancySlice type)
 * Risk-sensitive: NO — advisory only, adjusts composite ranking score
 * Last modified: 2026-03-01
 * Notes: Converts EV tracker statistics into a composite score modifier.
 *        Penalises historically low-expectancy sleeve/ATR/regime combos,
 *        boosts high-expectancy ones. Activates only when sufficient data
 *        exists (≥10 trades for the specific combination).
 */

import type { ExpectancySlice } from './ev-tracker';

// ── Constants ────────────────────────────────────────────────

/** Minimum trades required for the EV modifier to activate */
const MIN_TRADES_FOR_SIGNAL = 10;

// ── Types ────────────────────────────────────────────────────

export type EVDataQuality = 'SUFFICIENT' | 'INSUFFICIENT' | 'NO_DATA';

export interface EVModifierResult {
  /** Additive modifier to apply to compositeScore (-10 to +5) */
  modifier: number;
  /** Whether we have enough data to trust the modifier */
  dataQuality: EVDataQuality;
  /** Number of trades in this combination */
  tradeCount: number;
  /** The raw expectancy (R) for this combination, null if no data */
  expectancy: number | null;
}

// ── ATR Bucket Classification ────────────────────────────────
// Mirrors ev-tracker.ts thresholds exactly. Exported so callers
// can classify ATR% without importing ev-tracker (which needs Prisma).

export function classifyAtrBucket(atrPercent: number | null | undefined): string {
  if (atrPercent == null || atrPercent <= 0) return 'UNKNOWN';
  if (atrPercent < 2) return 'LOW';
  if (atrPercent < 4) return 'MEDIUM';
  if (atrPercent < 7) return 'HIGH';
  return 'EXTREME';
}

// ── EV Modifier Tiers ────────────────────────────────────────
// Maps expectancy (R) ranges to score adjustments.
// Positive expectancy → small boost (we don't want to over-weight history).
// Negative expectancy → meaningful penalty (protect capital from bad combos).
//
// | Expectancy   | Modifier | Rationale                              |
// |-------------|----------|----------------------------------------|
// | > 0.5R      | +5       | Strong edge — slight ranking boost      |
// | 0R – 0.5R   |  0       | Marginally profitable — no change       |
// | -0.5R – 0R  | -5       | Marginally negative — mild penalty      |
// | < -0.5R     | -10      | Clear negative edge — strong penalty    |

function expectancyToModifier(expectancy: number): number {
  if (expectancy > 0.5) return 5;
  if (expectancy >= 0) return 0;
  if (expectancy >= -0.5) return -5;
  return -10;
}

// ── Main Function ────────────────────────────────────────────

/**
 * Compute the EV modifier for a candidate given its combination stats.
 * Pure function — no DB access. Caller must provide the ExpectancySlice.
 *
 * @param slice - Expectancy stats for the sleeve+ATR+regime combination (null if no records exist)
 * @returns EVModifierResult with modifier, data quality, and diagnostics
 */
export function getEVModifier(
  slice: ExpectancySlice | null
): EVModifierResult {
  // No data at all
  if (!slice || slice.tradeCount === 0) {
    return {
      modifier: 0,
      dataQuality: 'NO_DATA',
      tradeCount: 0,
      expectancy: null,
    };
  }

  // Insufficient data — we have some trades but not enough to trust
  if (slice.tradeCount < MIN_TRADES_FOR_SIGNAL) {
    return {
      modifier: 0,
      dataQuality: 'INSUFFICIENT',
      tradeCount: slice.tradeCount,
      expectancy: slice.expectancy,
    };
  }

  // Sufficient data — apply the modifier
  return {
    modifier: expectancyToModifier(slice.expectancy),
    dataQuality: 'SUFFICIENT',
    tradeCount: slice.tradeCount,
    expectancy: slice.expectancy,
  };
}
