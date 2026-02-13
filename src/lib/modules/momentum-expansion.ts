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

/**
 * Check if momentum expansion is active.
 * When SPY ADX > 25, allows expanding the max open risk.
 */
export function checkMomentumExpansion(
  spyAdx: number,
  riskProfile: RiskProfileType
): MomentumExpansionResult {
  const profile = RISK_PROFILES[riskProfile];
  const isExpanded = spyAdx > ADX_EXPANSION_THRESHOLD;

  return {
    adx: spyAdx,
    threshold: ADX_EXPANSION_THRESHOLD,
    expandedMaxRisk: isExpanded
      ? Math.round(profile.maxOpenRisk * EXPANSION_FACTOR * 10) / 10
      : null,
    isExpanded,
    reason: isExpanded
      ? `MOMENTUM: ADX ${spyAdx.toFixed(1)} > ${ADX_EXPANSION_THRESHOLD} — max risk expanded to ${(profile.maxOpenRisk * EXPANSION_FACTOR).toFixed(1)}%`
      : `ADX ${spyAdx.toFixed(1)} ≤ ${ADX_EXPANSION_THRESHOLD} — standard risk limits`,
  };
}
