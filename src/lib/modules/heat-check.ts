// ============================================================
// Module 8: Heat Check
// ============================================================
// If 3+ positions in same cluster, 4th must have momentum 20%
// better than average of existing. Prevents over-concentration
// in mediocre names.
// ============================================================

import 'server-only';
import type { HeatCheckResult } from '@/types';

interface PositionForHeat {
  ticker: string;
  cluster: string;
  rMultiple: number; // used as momentum proxy
  adx?: number;
}

interface CandidateForHeat {
  ticker: string;
  cluster: string;
  rankScore: number; // momentum proxy
  adx?: number;
}

const HEAT_THRESHOLD = 3;     // positions in cluster before check kicks in
const MOMENTUM_PREMIUM = 0.20; // 20% better momentum required

/**
 * Check if a new candidate passes the heat check for its cluster.
 * Blocks entry if 3+ positions exist and the candidate doesn't
 * have 20% better momentum than the cluster average.
 */
export function runHeatCheck(
  positions: PositionForHeat[],
  candidates: CandidateForHeat[]
): HeatCheckResult[] {
  const results: HeatCheckResult[] = [];

  // Group positions by cluster
  const clusterPositions = new Map<string, PositionForHeat[]>();
  for (const pos of positions) {
    if (!pos.cluster) continue;
    const list = clusterPositions.get(pos.cluster) || [];
    list.push(pos);
    clusterPositions.set(pos.cluster, list);
  }

  // Check each candidate against its cluster
  for (const candidate of candidates) {
    if (!candidate.cluster) continue;

    const existing = clusterPositions.get(candidate.cluster) || [];

    if (existing.length < HEAT_THRESHOLD) {
      results.push({
        cluster: candidate.cluster,
        positionsInCluster: existing.length,
        avgMomentum: 0,
        candidateTicker: candidate.ticker,
        candidateMomentum: candidate.rankScore,
        blocked: false,
        reason: `${existing.length}/${HEAT_THRESHOLD} positions in ${candidate.cluster} — no heat check needed`,
      });
      continue;
    }

    const avgMomentum = existing.reduce((sum, p) => sum + p.rMultiple, 0) / existing.length;
    const threshold = avgMomentum * (1 + MOMENTUM_PREMIUM);
    const candidateMomentum = candidate.rankScore / 100; // normalize
    const blocked = candidateMomentum <= threshold;

    results.push({
      cluster: candidate.cluster,
      positionsInCluster: existing.length,
      avgMomentum,
      candidateTicker: candidate.ticker,
      candidateMomentum: candidate.rankScore,
      blocked,
      reason: blocked
        ? `BLOCKED: ${candidate.ticker} momentum (${candidateMomentum.toFixed(2)}) ≤ ${threshold.toFixed(2)} (avg ${avgMomentum.toFixed(2)} + 20%) in ${candidate.cluster}`
        : `PASS: ${candidate.ticker} momentum exceeds cluster average by >20%`,
    });
  }

  return results;
}
