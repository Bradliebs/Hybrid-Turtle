// ============================================================
// Module 12: Super-Cluster Risk Cap (50%)
// ============================================================
// Groups correlated clusters into super-clusters
// (e.g., MEGA_TECH_AI) with a 50% aggregate cap.
// ============================================================

import 'server-only';
import { SUPER_CLUSTER_CAP } from '@/types';
import type { Sleeve } from '@/types';

interface PositionForSuperCluster {
  ticker: string;
  superCluster: string | null;
  value: number;
  sleeve: Sleeve;
}

export interface SuperClusterBreachResult {
  superCluster: string;
  currentPct: number;
  capPct: number;
  breached: boolean;
  positions: string[];
  reason: string;
}

/**
 * Minimum number of distinct super-clusters required before enforcement.
 * With only 1-2 positions the single super-cluster will naturally be 100%
 * which is expected, not a real concentration breach.
 */
const MIN_SUPER_CLUSTERS_FOR_CAP = 2;

/**
 * Check super-cluster concentration limits.
 * Returns breaches where any super-cluster exceeds 50% of portfolio.
 * Skips breach flagging when fewer than MIN_SUPER_CLUSTERS_FOR_CAP
 * distinct super-clusters are present (too few positions to diversify).
 */
export function checkSuperClusterCaps(
  positions: PositionForSuperCluster[],
  totalPortfolioValue: number
): SuperClusterBreachResult[] {
  const results: SuperClusterBreachResult[] = [];

  if (totalPortfolioValue <= 0) return results;

  // Group by super-cluster
  const scGroups = new Map<string, { value: number; tickers: string[] }>();

  for (const pos of positions) {
    const sc = pos.superCluster || 'UNCATEGORIZED';
    const group = scGroups.get(sc) || { value: 0, tickers: [] };
    group.value += pos.value;
    group.tickers.push(pos.ticker);
    scGroups.set(sc, group);
  }

  // With fewer than MIN_SUPER_CLUSTERS_FOR_CAP distinct super-clusters,
  // concentration is expected — report percentages but never flag a breach.
  const tooFewGroups = scGroups.size < MIN_SUPER_CLUSTERS_FOR_CAP;

  for (const [sc, group] of Array.from(scGroups)) {
    const pct = group.value / totalPortfolioValue;
    const wouldBreach = pct > SUPER_CLUSTER_CAP;
    const breached = wouldBreach && !tooFewGroups;
    results.push({
      superCluster: sc,
      currentPct: pct * 100,
      capPct: SUPER_CLUSTER_CAP * 100,
      breached,
      positions: group.tickers,
      reason: breached
        ? `BREACH: ${sc} at ${(pct * 100).toFixed(1)}% (cap ${(SUPER_CLUSTER_CAP * 100).toFixed(0)}%)`
        : `${sc}: ${(pct * 100).toFixed(1)}% / ${(SUPER_CLUSTER_CAP * 100).toFixed(0)}%`,
    });
  }

  return results.sort((a, b) => b.currentPct - a.currentPct);
}
