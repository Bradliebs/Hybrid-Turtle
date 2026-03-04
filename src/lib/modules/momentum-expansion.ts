/**
 * Module 13: Momentum Expansion
 *
 * STATUS: DISABLED — controlled by FEATURE_FLAGS.MODULE_MOMENTUM_EXPANSION
 *
 * This module is gated by a feature flag and will not execute unless
 * the flag is explicitly enabled in src/lib/feature-flags.ts.
 *
 * WARNING: This module affects position sizing. Enabling it will
 * change the number of shares purchased per trade. Extra validation
 * required beyond standard module testing.
 *
 * BEFORE ENABLING:
 * 1. Run backtesting validation against SnapshotTicker historical data
 * 2. Verify results against system expectancy benchmarks
 * 3. Test in paper trading for a minimum of 4 weeks
 * 4. Update this comment with validation results and date
 *
 * Do not enable on a live account without completing the above.
 */
// ============================================================
// Module 13: Momentum Expansion
// ============================================================
// Expands max open risk from 7% → 8.5% when ADX > 25
// (strong trend). Uses static caps otherwise.
// ============================================================

import 'server-only';
import type { MomentumExpansionResult, RiskProfileType } from '@/types';
import { RISK_PROFILES } from '@/types';

const ADX_EXPANSION_THRESHOLD = 25;
const EXPANSION_FACTOR = 1.214; // ~8.5% / 7.0%
// Absolute ceiling — no profile should ever expand beyond this
const MAX_EXPANDED_RISK = 12.0;

/**
 * Check if momentum expansion is active.
 * When SPY ADX > 25, allows expanding the max open risk.
 * Capped at MAX_EXPANDED_RISK to prevent SMALL_ACCOUNT (10%)
 * from scaling to unsafe levels.
 */
export function checkMomentumExpansion(
  spyAdx: number,
  riskProfile: RiskProfileType
): MomentumExpansionResult {
  const profile = RISK_PROFILES[riskProfile];
  const isExpanded = spyAdx > ADX_EXPANSION_THRESHOLD;

  const rawExpanded = profile.maxOpenRisk * EXPANSION_FACTOR;
  // Cap at absolute ceiling so SMALL_ACCOUNT (10% × 1.214 = 12.14%) doesn't breach
  const cappedExpanded = Math.min(rawExpanded, MAX_EXPANDED_RISK);
  const expandedRisk = Math.round(cappedExpanded * 10) / 10;

  return {
    adx: spyAdx,
    threshold: ADX_EXPANSION_THRESHOLD,
    expandedMaxRisk: isExpanded ? expandedRisk : null,
    isExpanded,
    reason: isExpanded
      ? `MOMENTUM: ADX ${spyAdx.toFixed(1)} > ${ADX_EXPANSION_THRESHOLD} — max risk expanded to ${expandedRisk.toFixed(1)}%`
      : `ADX ${spyAdx.toFixed(1)} ≤ ${ADX_EXPANSION_THRESHOLD} — standard risk limits`,
  };
}
