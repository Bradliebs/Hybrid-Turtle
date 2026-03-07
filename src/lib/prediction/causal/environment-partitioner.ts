/**
 * DEPENDENCIES
 * Consumed by: irm-trainer.ts
 * Consumes: prisma.ts (ScoreBreakdown + CandidateOutcome tables)
 * Risk-sensitive: NO — data partitioning only
 * Last modified: 2026-03-07
 * Notes: Partitions historical scan data into regime environments for IRM.
 *        Each environment = one market regime's worth of (signal, outcome) pairs.
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────

export type IRMEnvironment = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION';

export const IRM_ENVIRONMENTS: IRMEnvironment[] = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];

export interface EnvironmentData {
  environment: IRMEnvironment;
  /** Each row: [signal_values..., outcome] */
  samples: Array<{ signals: number[]; outcome: number }>;
}

export const SIGNAL_NAMES = [
  'bqsTrend', 'bqsDirection', 'bqsVolatility', 'bqsProximity',
  'bqsTailwind', 'bqsRs', 'bqsWeeklyAdx', 'bqsBis', 'bqsHurst', 'bqsVolBonus',
] as const;

export const SIGNAL_COUNT = SIGNAL_NAMES.length;

// ── Regime Mapping ───────────────────────────────────────────

function mapRegime(regime: string): IRMEnvironment {
  const upper = regime.toUpperCase();
  if (upper === 'BULLISH') return 'TRENDING';
  if (upper === 'BEARISH' || upper === 'SIDEWAYS' || upper === 'NEUTRAL') return 'RANGING';
  if (upper.includes('VOLATILE') || upper.includes('HIGH_VOL')) return 'VOLATILE';
  return 'TRANSITION';
}

// ── Data Loading ─────────────────────────────────────────────

/**
 * Load historical score data and partition into regime environments.
 * Uses ScoreBreakdown table with optional outcomeR (falls back to NCS).
 */
export async function loadEnvironmentData(minSamplesPerEnv = 20): Promise<EnvironmentData[]> {
  const rows = await prisma.scoreBreakdown.findMany({
    select: {
      regime: true,
      bqsTrend: true, bqsDirection: true, bqsVolatility: true,
      bqsProximity: true, bqsTailwind: true, bqsRs: true,
      bqsWeeklyAdx: true, bqsBis: true, bqsHurst: true,
      bqsVolBonus: true, ncsTotal: true, outcomeR: true,
    },
    orderBy: { scoredAt: 'desc' },
    take: 3000,
  });

  // Partition by regime
  const envMap = new Map<IRMEnvironment, EnvironmentData>();
  for (const env of IRM_ENVIRONMENTS) {
    envMap.set(env, { environment: env, samples: [] });
  }

  for (const row of rows) {
    const env = mapRegime(row.regime);
    const data = envMap.get(env)!;

    const signals = [
      row.bqsTrend, row.bqsDirection, row.bqsVolatility, row.bqsProximity,
      row.bqsTailwind, row.bqsRs, row.bqsWeeklyAdx, row.bqsBis,
      row.bqsHurst, row.bqsVolBonus,
    ];

    // Outcome: real R-multiple if available, else NCS as proxy
    const outcome = row.outcomeR ?? row.ncsTotal / 100;

    data.samples.push({ signals, outcome });
  }

  // Only return environments with enough data
  return IRM_ENVIRONMENTS
    .map(env => envMap.get(env)!)
    .filter(ed => ed.samples.length >= minSamplesPerEnv);
}
