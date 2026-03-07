/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/signal-audit/route.ts, /signal-audit/page.tsx
 * Consumes: prisma.ts (ScoreBreakdown + CandidateOutcome tables)
 * Risk-sensitive: NO — analysis only, no position changes
 * Last modified: 2026-03-07
 * Notes: Measures unique information contribution of each signal layer using
 *        mutual information (MI). Produces a 7×7 MI matrix and conditional MI
 *        vector for pruning recommendations.
 *        ⛔ ANALYSIS ONLY — does not modify NCS or any sacred files.
 *        Any weight changes resulting from analysis are applied via Phase 3 meta-model.
 */

import { prisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────

export type SignalName = 'trend' | 'direction' | 'volatility' | 'proximity' | 'tailwind' | 'rs' | 'weeklyAdx' | 'bis' | 'hurst' | 'volBonus';

export const SIGNAL_NAMES: SignalName[] = [
  'trend', 'direction', 'volatility', 'proximity', 'tailwind',
  'rs', 'weeklyAdx', 'bis', 'hurst', 'volBonus',
];

export const SIGNAL_LABELS: Record<SignalName, string> = {
  trend: 'Trend (ADX)',
  direction: 'Direction (DI)',
  volatility: 'Volatility Health',
  proximity: 'Proximity',
  tailwind: 'Market Tailwind (DRS)',
  rs: 'Relative Strength',
  weeklyAdx: 'Weekly ADX',
  bis: 'Breakout Integrity',
  hurst: 'Hurst Persistence',
  volBonus: 'Volume Bonus',
};

export interface MIMatrixEntry {
  signalA: SignalName;
  signalB: SignalName;
  mi: number;
}

export interface ConditionalMIEntry {
  signal: SignalName;
  conditionalMI: number;
  recommendation: 'KEEP' | 'INVESTIGATE' | 'REDUNDANT';
}

export interface SignalAuditReport {
  miMatrix: MIMatrixEntry[];
  conditionalMI: ConditionalMIEntry[];
  sampleSize: number;
  computedAt: Date;
  /** Pairs with MI > 0.7 — suggest merging */
  highCorrelationPairs: Array<{ signalA: SignalName; signalB: SignalName; mi: number }>;
}

// ── Equal-Frequency Binning ──────────────────────────────────
// Discretise continuous signal values into N bins with approximately
// equal numbers of observations per bin (quantile binning).

const NUM_BINS = 10;

function equalFrequencyBin(values: number[]): number[] {
  if (values.length === 0) return [];

  // Create sorted index array for rank-based binning
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const binned = new Array<number>(values.length);
  for (let rank = 0; rank < indexed.length; rank++) {
    const bin = Math.min(Math.floor((rank / indexed.length) * NUM_BINS), NUM_BINS - 1);
    binned[indexed[rank].i] = bin;
  }

  return binned;
}

// ── Mutual Information Computation ───────────────────────────
// MI(X;Y) = Σ p(x,y) × log2(p(x,y) / (p(x) × p(y)))

function computeMI(binnedX: number[], binnedY: number[]): number {
  const n = binnedX.length;
  if (n === 0) return 0;

  // Joint and marginal frequency counts
  const jointCounts = new Map<string, number>();
  const xCounts = new Map<number, number>();
  const yCounts = new Map<number, number>();

  for (let i = 0; i < n; i++) {
    const key = `${binnedX[i]},${binnedY[i]}`;
    jointCounts.set(key, (jointCounts.get(key) ?? 0) + 1);
    xCounts.set(binnedX[i], (xCounts.get(binnedX[i]) ?? 0) + 1);
    yCounts.set(binnedY[i], (yCounts.get(binnedY[i]) ?? 0) + 1);
  }

  let mi = 0;
  for (const [key, count] of Array.from(jointCounts.entries())) {
    const [xStr, yStr] = key.split(',');
    const xBin = parseInt(xStr);
    const yBin = parseInt(yStr);

    const pxy = count / n;
    const px = (xCounts.get(xBin) ?? 0) / n;
    const py = (yCounts.get(yBin) ?? 0) / n;

    if (px > 0 && py > 0 && pxy > 0) {
      mi += pxy * Math.log2(pxy / (px * py));
    }
  }

  return Math.max(0, mi); // MI is non-negative, clamp floating point errors
}

// ── Conditional MI Approximation ─────────────────────────────
// MI(signal_i ; outcome | all other signals)
// Approximated by: MI(signal_i ; outcome) - max_j≠i MI(signal_i ; signal_j) × penalty
// This gives a rough measure of unique contribution.

function computeConditionalMI(
  signalBinned: number[][],
  outcomeBinned: number[],
  signalIndex: number,
  miMatrix: number[][]
): number {
  // MI between this signal and the outcome
  const miWithOutcome = computeMI(signalBinned[signalIndex], outcomeBinned);

  // Max MI this signal has with any other signal (redundancy)
  let maxPairwiseMI = 0;
  for (let j = 0; j < signalBinned.length; j++) {
    if (j !== signalIndex) {
      maxPairwiseMI = Math.max(maxPairwiseMI, miMatrix[signalIndex][j]);
    }
  }

  // Conditional MI ≈ MI(signal; outcome) × (1 - redundancy_factor)
  // Where redundancy_factor is how much of the signal's info is already captured by another
  const redundancyFactor = Math.min(maxPairwiseMI / Math.max(miWithOutcome, 0.001), 1);
  return miWithOutcome * (1 - redundancyFactor * 0.5);
}

// ── Recommendation Classification ────────────────────────────

function classifySignal(condMI: number): 'KEEP' | 'INVESTIGATE' | 'REDUNDANT' {
  if (condMI > 0.15) return 'KEEP';
  if (condMI >= 0.05) return 'INVESTIGATE';
  return 'REDUNDANT';
}

// ── Data Loading ─────────────────────────────────────────────

interface SignalRow {
  bqsTrend: number;
  bqsDirection: number;
  bqsVolatility: number;
  bqsProximity: number;
  bqsTailwind: number;
  bqsRs: number;
  bqsWeeklyAdx: number;
  bqsBis: number;
  bqsHurst: number;
  bqsVolBonus: number;
  ncsTotal: number;
  outcomeR: number | null;
}

/**
 * Load signal data from ScoreBreakdown table.
 * Prefers rows with outcome data (outcomeR not null) but falls back to NCS as outcome.
 */
async function loadSignalData(minRows = 100): Promise<{ rows: SignalRow[]; hasOutcomes: boolean }> {
  // First try rows with actual outcomes
  const withOutcomes = await prisma.scoreBreakdown.findMany({
    where: { outcomeR: { not: null } },
    select: {
      bqsTrend: true, bqsDirection: true, bqsVolatility: true,
      bqsProximity: true, bqsTailwind: true, bqsRs: true,
      bqsWeeklyAdx: true, bqsBis: true, bqsHurst: true,
      bqsVolBonus: true, ncsTotal: true, outcomeR: true,
    },
    orderBy: { scoredAt: 'desc' },
    take: 2000,
  });

  if (withOutcomes.length >= minRows) {
    return { rows: withOutcomes, hasOutcomes: true };
  }

  // Fall back to all rows using NCS as a proxy outcome
  const allRows = await prisma.scoreBreakdown.findMany({
    select: {
      bqsTrend: true, bqsDirection: true, bqsVolatility: true,
      bqsProximity: true, bqsTailwind: true, bqsRs: true,
      bqsWeeklyAdx: true, bqsBis: true, bqsHurst: true,
      bqsVolBonus: true, ncsTotal: true, outcomeR: true,
    },
    orderBy: { scoredAt: 'desc' },
    take: 2000,
  });

  return { rows: allRows, hasOutcomes: false };
}

// ── Main Analysis Pipeline ───────────────────────────────────

/**
 * Run the full mutual information analysis across historical score data.
 * Returns a structured report with MI matrix, conditional MI, and recommendations.
 */
export async function runSignalAudit(): Promise<SignalAuditReport> {
  const { rows, hasOutcomes } = await loadSignalData(50);

  if (rows.length < 50) {
    // Not enough data — return empty report
    return {
      miMatrix: [],
      conditionalMI: SIGNAL_NAMES.map(s => ({
        signal: s,
        conditionalMI: 0,
        recommendation: 'INVESTIGATE' as const,
      })),
      sampleSize: rows.length,
      computedAt: new Date(),
      highCorrelationPairs: [],
    };
  }

  // Extract signal arrays (10 signals)
  const signalExtractors: Array<(r: SignalRow) => number> = [
    r => r.bqsTrend,
    r => r.bqsDirection,
    r => r.bqsVolatility,
    r => r.bqsProximity,
    r => r.bqsTailwind,
    r => r.bqsRs,
    r => r.bqsWeeklyAdx,
    r => r.bqsBis,
    r => r.bqsHurst,
    r => r.bqsVolBonus,
  ];

  const rawSignals = signalExtractors.map(ext => rows.map(ext));

  // Outcome: use outcomeR if available, otherwise NCS as proxy
  const rawOutcome = rows.map(r => hasOutcomes ? (r.outcomeR ?? r.ncsTotal) : r.ncsTotal);

  // Bin all signals and outcome
  const binnedSignals = rawSignals.map(equalFrequencyBin);
  const binnedOutcome = equalFrequencyBin(rawOutcome);

  // Compute pairwise MI matrix (10 × 10)
  const nSignals = SIGNAL_NAMES.length;
  const miMatrixRaw: number[][] = Array.from({ length: nSignals }, () =>
    new Array(nSignals).fill(0)
  );

  const miMatrixEntries: MIMatrixEntry[] = [];

  for (let i = 0; i < nSignals; i++) {
    for (let j = i; j < nSignals; j++) {
      const mi = i === j ? computeMI(binnedSignals[i], binnedOutcome) : computeMI(binnedSignals[i], binnedSignals[j]);
      miMatrixRaw[i][j] = mi;
      miMatrixRaw[j][i] = mi;

      miMatrixEntries.push({
        signalA: SIGNAL_NAMES[i],
        signalB: SIGNAL_NAMES[j],
        mi: Math.round(mi * 1000) / 1000,
      });
    }
  }

  // Compute conditional MI for each signal
  const conditionalMI: ConditionalMIEntry[] = SIGNAL_NAMES.map((name, i) => {
    const condMI = computeConditionalMI(binnedSignals, binnedOutcome, i, miMatrixRaw);
    return {
      signal: name,
      conditionalMI: Math.round(condMI * 1000) / 1000,
      recommendation: classifySignal(condMI),
    };
  });

  // Find high-correlation pairs (MI > 0.7 between signals, not with outcome)
  const highCorrelationPairs: SignalAuditReport['highCorrelationPairs'] = [];
  for (let i = 0; i < nSignals; i++) {
    for (let j = i + 1; j < nSignals; j++) {
      if (miMatrixRaw[i][j] > 0.7) {
        highCorrelationPairs.push({
          signalA: SIGNAL_NAMES[i],
          signalB: SIGNAL_NAMES[j],
          mi: Math.round(miMatrixRaw[i][j] * 1000) / 1000,
        });
      }
    }
  }

  return {
    miMatrix: miMatrixEntries,
    conditionalMI: conditionalMI.sort((a, b) => b.conditionalMI - a.conditionalMI),
    sampleSize: rows.length,
    computedAt: new Date(),
    highCorrelationPairs,
  };
}
