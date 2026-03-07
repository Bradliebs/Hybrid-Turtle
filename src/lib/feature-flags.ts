/**
 * DEPENDENCIES
 * Consumed by: /api/modules/route.ts, nightly.ts, SystemPanel, /api/feature-flags
 * Consumes: (pure data — no imports)
 * Risk-sensitive: YES — flags control which risk modules are active
 * Last modified: 2026-03-04
 * Notes: Single source of truth for all feature flags.
 *        Flags are code-only — no environment variables, no database, no UI toggles.
 *        Change a flag to true and restart the server to activate.
 */

/**
 * Feature flags for HybridTurtle.
 *
 * Modules or features that are not yet ready for live use are listed here.
 * To activate a feature: change its flag to true and restart the server.
 *
 * DO NOT set a flag to true unless the feature has been fully tested.
 * Flags marked REQUIRES_TESTING must pass backtesting validation before
 * being enabled on a live account.
 */
export const FEATURE_FLAGS = {
  /**
   * Module 9: Fast Follower
   * Re-entry after breakout pullback — catches shakeout recoveries.
   * Status: Implementation complete, not yet backtested.
   * REQUIRES_TESTING before enabling on live account.
   */
  MODULE_FAST_FOLLOWER: false,

  /**
   * Module 13: Momentum Expansion
   * Expands max open risk limit in strong trends (ADX > 25).
   * Status: Implementation complete, not yet backtested.
   * REQUIRES_TESTING before enabling on live account.
   * WARNING: Affects position sizing — extra caution required.
   */
  MODULE_MOMENTUM_EXPANSION: false,

  /**
   * Benchmark Scan Mode
   * Enables /api/scan/benchmark endpoint that runs MA200-only scan.
   * Produces an "unfiltered" baseline for measuring the value added
   * by ADX, Hurst, earnings, anti-chase, and other pipeline filters.
   * Safe to enable — read-only, no orders, no risk impact.
   */
  BENCHMARK_SCAN_MODE: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Returns true if a feature flag is enabled.
 * Usage: if (isEnabled('MODULE_FAST_FOLLOWER')) { ... }
 */
export function isEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}

// ── Flag descriptions (for UI display) ──

const FLAG_DESCRIPTIONS: Record<FeatureFlag, string> = {
  MODULE_FAST_FOLLOWER: 'Module 9: Fast Follower — re-entry after breakout pullback. Requires backtesting.',
  MODULE_MOMENTUM_EXPANSION: 'Module 13: Momentum Expansion — expands risk in strong trends. Requires backtesting. WARNING: affects position sizing.',
  BENCHMARK_SCAN_MODE: 'Benchmark Scan: MA200-only baseline scan for filter attribution analysis. Safe — read-only.',
};

/**
 * Returns all flags and their current state. Used by the settings UI.
 */
export function getAllFlags(): Array<{
  flag: FeatureFlag;
  enabled: boolean;
  description: string;
}> {
  return (Object.keys(FEATURE_FLAGS) as FeatureFlag[])
    .sort()
    .map((flag) => ({
      flag,
      enabled: FEATURE_FLAGS[flag],
      description: FLAG_DESCRIPTIONS[flag],
    }));
}
