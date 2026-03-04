/**
 * DEPENDENCIES
 * Consumed by: ModuleStatusPanel.tsx, TodayDirectiveCard.tsx (future)
 * Consumes: (pure data — no imports)
 * Risk-sensitive: NO (display organisation only)
 * Last modified: 2026-03-03
 * Notes: Defines three visual buckets for the 21 module statuses.
 *        Module IDs match the id field from /api/modules moduleStatuses[].
 *        Every module must appear in exactly one bucket.
 */

import type { ModuleStatus } from '@/types';

// ── Types ──

export type ModuleBucket = 'ENTRY_BLOCKERS' | 'EXIT_SIGNALS' | 'BACKGROUND' | 'PLANNED';

export interface BucketDefinition {
  id: ModuleBucket;
  label: string;
  description: string;
  /** Module id values from /api/modules — matches ModuleStatus.id */
  moduleIds: number[];
}

// ── Bucket definitions ──
// Module IDs verified against /api/modules/route.ts moduleStatuses array.

export const MODULE_BUCKETS: BucketDefinition[] = [
  {
    id: 'ENTRY_BLOCKERS',
    label: 'Entry Blockers',
    description: 'These modules can prevent new positions from being opened',
    moduleIds: [8, 10, 11, 12],
    // 8  Heat Check — blocks entries on concentration
    // 10 Breadth Safety Valve — caps max positions
    // 11 Whipsaw Kill Switch — blocks re-entry on stopped tickers
    // 12 Super-Cluster Cap — blocks entry on aggregate cluster cap
  },
  {
    id: 'EXIT_SIGNALS',
    label: 'Exit & Swap Signals',
    description: 'These modules flag existing positions that may need action',
    moduleIds: [3, 5, 7, 14, 20],
    // 3  Laggard Purge — flags dead money for exit
    // 5  Climax Top Exit — flags parabolic exhaustion for exit
    // 7  Heat-Map Swap — suggests swapping weak for strong
    // 14 Climax Trim/Tighten — suggests trimming or tightening stops
    // 20 Re-Entry Logic — monitors exits for re-entry opportunities
  },
  {
    id: 'BACKGROUND',
    label: 'Background Monitors',
    description: 'Running silently — no immediate action required',
    moduleIds: [2, 9.1, 15, 16, 17, 18, 19, 21],
    // 2   Early Bird Entry — alternative entries (on-demand)
    // 9.1 Regime Stability — consecutive-day regime tracking
    // 15  Trades Log — logging only
    // 16  Turnover Monitor — holding period tracker
    // 17  Weekly Action Card — reporting only
    // 18  Data Validation — data quality gate
    // 19  Dual Benchmark — SPY + VWRL regime display
    // 21  Position Tracking — open/closed counts
  },
  {
    id: 'PLANNED',
    label: 'Planned Modules',
    description: 'Implemented but not yet enabled. Will be activated after backtesting validation.',
    moduleIds: [9, 13],
    // 9   Fast-Follower Re-Entry — gated by MODULE_FAST_FOLLOWER flag
    // 13  Momentum Expansion — gated by MODULE_MOMENTUM_EXPANSION flag
  },
];

// ── Set of all assigned IDs for fast lookup ──
const ALL_ASSIGNED_IDS = new Set(MODULE_BUCKETS.flatMap((b) => b.moduleIds));

// ── Helpers ──

/** Check if a status counts as "active" (needs attention) */
function isActiveStatus(status: ModuleStatus['status']): boolean {
  return status === 'RED' || status === 'YELLOW';
}

/** Build a lookup: moduleId → bucket */
export function getBucketForModule(moduleId: number): ModuleBucket | null {
  for (const bucket of MODULE_BUCKETS) {
    if (bucket.moduleIds.includes(moduleId)) return bucket.id;
  }
  return null;
}

/** Per-bucket summary counts */
export interface BucketSummary {
  id: ModuleBucket;
  label: string;
  activeCount: number;
  totalCount: number;
}

/** Generate a one-line summary string for the dashboard header */
export function getModuleSummary(
  moduleStatuses: ModuleStatus[]
): { buckets: BucketSummary[]; text: string } {
  const buckets: BucketSummary[] = MODULE_BUCKETS.map((bucket) => {
    const modules = moduleStatuses.filter((m) => bucket.moduleIds.includes(m.id));
    const activeCount = modules.filter((m) => isActiveStatus(m.status)).length;
    return {
      id: bucket.id,
      label: bucket.label,
      activeCount,
      totalCount: modules.length,
    };
  });

  const parts = buckets.map((b) =>
    b.activeCount > 0
      ? `${b.label}: ${b.activeCount} active`
      : `${b.label}: All clear`
  );

  return { buckets, text: parts.join(' · ') };
}

/** Get modules that don't belong to any defined bucket (future-proofing) */
export function getUncategorisedModules(moduleStatuses: ModuleStatus[]): ModuleStatus[] {
  return moduleStatuses.filter((m) => !ALL_ASSIGNED_IDS.has(m.id));
}
