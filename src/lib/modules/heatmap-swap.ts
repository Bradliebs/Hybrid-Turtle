// ============================================================
// Module 7: Heat-Map Swap Logic
// ============================================================
// When a cluster is at cap, suggests swapping weakest holding
// for a stronger READY candidate in the same cluster.
//
// Guards against suggestion churn:
//   - Weak position must be < 0.5R AND negative
//   - Strong candidate must have rank ≥ 50
//   - Only suggests if the upgrade is meaningful
// ============================================================

import 'server-only';
import type { SwapSuggestion, Sleeve } from '@/types';
import { CLUSTER_CAP } from '@/types';

const WEAK_R_THRESHOLD = 0.5;        // Weak side must be below this R
const WEAK_MUST_BE_NEGATIVE = true;  // Only suggest if weak pos is underwater
const MIN_CANDIDATE_RANK = 50;       // Strong side must score at least this

interface PositionForSwap {
  id: string;
  ticker: string;
  cluster: string;
  sleeve: Sleeve;
  value: number;
  rMultiple: number;
}

interface CandidateForSwap {
  ticker: string;
  cluster: string;
  rankScore: number;
  status: string; // READY | WATCH
}

/**
 * Find swap suggestions where a cluster is at cap and a stronger
 * candidate exists in the same cluster.
 */
export function findSwapSuggestions(
  positions: PositionForSwap[],
  candidates: CandidateForSwap[],
  totalPortfolioValue: number
): SwapSuggestion[] {
  const suggestions: SwapSuggestion[] = [];

  // Group positions by cluster
  const clusterPositions = new Map<string, PositionForSwap[]>();
  for (const pos of positions) {
    if (!pos.cluster) continue;
    const list = clusterPositions.get(pos.cluster) || [];
    list.push(pos);
    clusterPositions.set(pos.cluster, list);
  }

  for (const [cluster, clusterPos] of Array.from(clusterPositions)) {
    const clusterValue = clusterPos.reduce((s: number, p: PositionForSwap) => s + p.value, 0);
    const clusterPct = totalPortfolioValue > 0 ? clusterValue / totalPortfolioValue : 0;

    // Only suggest swaps if cluster is near or at cap (≥80%)
    if (clusterPct < CLUSTER_CAP * 0.8) continue;

    // Find weakest position in cluster (lowest R-multiple)
    const weakest = clusterPos.reduce((w: PositionForSwap, p: PositionForSwap) => (p.rMultiple < w.rMultiple ? p : w));

    // Guard: weak position must be genuinely weak, not just "less strong"
    if (weakest.rMultiple >= WEAK_R_THRESHOLD) continue;
    if (WEAK_MUST_BE_NEGATIVE && weakest.rMultiple >= 0) continue;

    // Find strongest READY candidate in same cluster
    const clusterCandidates = candidates
      .filter(c => c.cluster === cluster && c.status === 'READY')
      .filter(c => !positions.some(p => p.ticker === c.ticker)) // not already held
      .filter(c => c.rankScore >= MIN_CANDIDATE_RANK) // must be a quality candidate
      .sort((a, b) => b.rankScore - a.rankScore);

    if (clusterCandidates.length > 0) {
      const strongest = clusterCandidates[0];
      suggestions.push({
        cluster,
        weakTicker: weakest.ticker,
        weakRMultiple: weakest.rMultiple,
        strongTicker: strongest.ticker,
        strongRankScore: strongest.rankScore,
        reason: `Swap ${weakest.ticker} (${weakest.rMultiple.toFixed(1)}R) → ${strongest.ticker} (score ${strongest.rankScore.toFixed(0)}) in ${cluster}`,
      });
    }
  }

  return suggestions;
}
