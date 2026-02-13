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
 * Check super-cluster concentration limits.
 * Returns breaches where any super-cluster exceeds 50% of portfolio.
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

  for (const [sc, group] of Array.from(scGroups)) {
    const pct = group.value / totalPortfolioValue;
    results.push({
      superCluster: sc,
      currentPct: pct * 100,
      capPct: SUPER_CLUSTER_CAP * 100,
      breached: pct > SUPER_CLUSTER_CAP,
      positions: group.tickers,
      reason: pct > SUPER_CLUSTER_CAP
        ? `BREACH: ${sc} at ${(pct * 100).toFixed(1)}% (cap ${(SUPER_CLUSTER_CAP * 100).toFixed(0)}%)`
        : `${sc}: ${(pct * 100).toFixed(1)}% / ${(SUPER_CLUSTER_CAP * 100).toFixed(0)}%`,
    });
  }

  return results.sort((a, b) => b.currentPct - a.currentPct);
}
