/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/invariance/route.ts, display layer
 * Consumes: invariance-scores.ts, prisma.ts (RegimeHistory)
 * Risk-sensitive: NO — computation only
 * Last modified: 2026-03-07
 * Notes: Reweights NCS using invariance scores from IRM analysis.
 *        During regime transitions, down-weights signals with low invariance.
 *        This is a further refinement on top of Phase 3 meta-weights.
 *        ⛔ Does NOT modify dual-score.ts. Applied at display layer only.
 */

import { prisma } from '@/lib/prisma';
import { getLatestInvarianceScores, type SignalInvariance } from './invariance-scores';

// ── Types ────────────────────────────────────────────────────

export interface InvariantNCSInput {
  /** Raw BQS component values (10 values, same order as SIGNAL_NAMES) */
  bqsComponents: number[];
  /** FWS total */
  fws: number;
  /** Total penalties */
  totalPenalty: number;
  /** Current meta-weights from Phase 3 (10 values, or null for equal weighting) */
  metaWeights: number[] | null;
}

export interface InvariantNCSResult {
  /** Standard NCS (no invariance adjustment) */
  rawNCS: number;
  /** NCS reweighted by invariance scores */
  invariantNCS: number;
  /** Whether a regime transition penalty was applied */
  regimeTransitionPenalty: boolean;
  /** Per-signal invariance weights used */
  invarianceWeights: Array<{ signal: string; weight: number; classification: string }>;
}

// ── Constants ────────────────────────────────────────────────

/** Signals with invarianceScore below this are down-weighted during transitions */
const TRANSITION_CUTOFF = 0.4;

/** Days in new regime before transition penalty lifts */
const TRANSITION_GRACE_DAYS = 5;

// ── Computation ──────────────────────────────────────────────

/**
 * Compute invariance-weighted NCS.
 * Multiplies each BQS component by its invariance score before summing.
 * During regime transitions, further down-weights low-invariance signals.
 */
export async function computeInvariantNCS(input: InvariantNCSInput): Promise<InvariantNCSResult> {
  const { bqsComponents, fws, totalPenalty, metaWeights } = input;

  // Load invariance scores
  const latest = await getLatestInvarianceScores();

  // If no invariance data, return standard NCS
  if (!latest || latest.signals.length === 0) {
    const rawBQS = bqsComponents.reduce((s, v) => s + v, 0);
    const rawNCS = Math.max(0, Math.min(100, rawBQS - 0.8 * fws + 10 - Math.min(totalPenalty, 40)));
    return {
      rawNCS: Math.round(rawNCS * 100) / 100,
      invariantNCS: Math.round(rawNCS * 100) / 100,
      regimeTransitionPenalty: false,
      invarianceWeights: [],
    };
  }

  // Check if we're in a regime transition
  let inTransition = false;
  try {
    const recentRegimes = await prisma.regimeHistory.findMany({
      orderBy: { date: 'desc' },
      take: 2,
      select: { regime: true, consecutive: true },
    });
    if (recentRegimes.length >= 1) {
      inTransition = recentRegimes[0].consecutive < TRANSITION_GRACE_DAYS;
    }
  } catch {
    // Default to no transition
  }

  // Build invariance weight vector
  const invarianceWeights: InvariantNCSResult['invarianceWeights'] = [];
  const adjustedBQS = bqsComponents.map((component, i) => {
    const signalInfo = latest.signals[i];
    if (!signalInfo) {
      invarianceWeights.push({ signal: `signal_${i}`, weight: 1, classification: 'MIXED' });
      return component;
    }

    let weight = signalInfo.invarianceScore;

    // During transition: further penalise low-invariance signals
    if (inTransition && signalInfo.invarianceScore < TRANSITION_CUTOFF) {
      weight *= 0.5; // halve the weight of regime-dependent signals during transition
    }

    // Apply meta-weight if available
    const metaWeight = metaWeights?.[i] ?? 1;
    const finalWeight = weight * metaWeight;

    invarianceWeights.push({
      signal: signalInfo.signal,
      weight: Math.round(finalWeight * 1000) / 1000,
      classification: signalInfo.classification,
    });

    return component * finalWeight;
  });

  // Compute both NCS values
  const rawBQS = bqsComponents.reduce((s, v) => s + v, 0);
  const rawNCS = Math.max(0, Math.min(100, rawBQS - 0.8 * fws + 10 - Math.min(totalPenalty, 40)));

  const adjBQS = adjustedBQS.reduce((s, v) => s + v, 0);
  const invariantNCS = Math.max(0, Math.min(100, adjBQS - 0.8 * fws + 10 - Math.min(totalPenalty, 40)));

  return {
    rawNCS: Math.round(rawNCS * 100) / 100,
    invariantNCS: Math.round(invariantNCS * 100) / 100,
    regimeTransitionPenalty: inTransition,
    invarianceWeights,
  };
}
