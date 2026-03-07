/**
 * DEPENDENCIES
 * Consumed by: invariant-ncs.ts, /api/prediction/invariance/route.ts
 * Consumes: irm-trainer.ts, prisma.ts
 * Risk-sensitive: NO — scoring/persistence only
 * Last modified: 2026-03-07
 * Notes: Stores and retrieves invariance scores per signal.
 *        Scores are recomputed periodically (monthly recommended).
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';
import { runIRMTraining, type IRMTrainingResult, type SignalInvariance } from './irm-trainer';

export type { SignalInvariance };

// ── Persistence ──────────────────────────────────────────────

/**
 * Run IRM analysis and store results in the database.
 */
export async function computeAndStoreInvarianceScores(): Promise<IRMTrainingResult> {
  const result = await runIRMTraining();

  await prisma.invarianceAuditResult.create({
    data: {
      sampleSize: result.totalSamples,
      environmentCount: result.environmentsUsed.length,
      environmentsUsed: JSON.stringify(result.environmentsUsed),
      scoresJson: JSON.stringify(result.signals),
      summary: buildSummary(result),
    },
  });

  return result;
}

/**
 * Load the latest stored invariance scores.
 */
export async function getLatestInvarianceScores(): Promise<{
  signals: SignalInvariance[];
  computedAt: Date;
  sampleSize: number;
} | null> {
  const latest = await prisma.invarianceAuditResult.findFirst({
    orderBy: { computedAt: 'desc' },
  });

  if (!latest) return null;

  return {
    signals: JSON.parse(latest.scoresJson) as SignalInvariance[],
    computedAt: latest.computedAt,
    sampleSize: latest.sampleSize,
  };
}

/**
 * Load all historical invariance audit runs (for trend chart).
 * Returns up to 20 most recent runs.
 */
export async function getHistoricalInvarianceRuns(): Promise<Array<{
  computedAt: Date;
  signalScores: Record<string, number>;
}>> {
  const runs = await prisma.invarianceAuditResult.findMany({
    orderBy: { computedAt: 'desc' },
    take: 20,
    select: { computedAt: true, scoresJson: true },
  });

  return runs.reverse().map(r => {
    const signals = JSON.parse(r.scoresJson) as SignalInvariance[];
    const scores: Record<string, number> = {};
    for (const s of signals) {
      scores[s.signal] = s.invarianceScore;
    }
    return { computedAt: r.computedAt, signalScores: scores };
  });
}

/**
 * Get invariance score for a specific signal (from latest audit).
 * Returns 0.5 (unknown) if no audit exists.
 */
export async function getSignalInvarianceScore(signalName: string): Promise<number> {
  const latest = await getLatestInvarianceScores();
  if (!latest) return 0.5;

  const found = latest.signals.find(s => s.signal === signalName);
  return found?.invarianceScore ?? 0.5;
}

// ── Summary Builder ──────────────────────────────────────────

function buildSummary(result: IRMTrainingResult): string {
  const causal = result.signals.filter(s => s.classification === 'CAUSAL');
  const spurious = result.signals.filter(s => s.classification === 'SPURIOUS');

  const signalLabels: Record<string, string> = {
    bqsTrend: 'Trend (ADX)', bqsDirection: 'Direction (DI)',
    bqsVolatility: 'Volatility', bqsProximity: 'Proximity',
    bqsTailwind: 'Regime (DRS)', bqsRs: 'Rel. Strength',
    bqsWeeklyAdx: 'Weekly ADX', bqsBis: 'BIS',
    bqsHurst: 'Hurst', bqsVolBonus: 'Vol Bonus',
  };

  return [
    `IRM analysis across ${result.environmentsUsed.length} environments, ${result.totalSamples} samples.`,
    causal.length > 0
      ? `Causal (stable): ${causal.map(s => signalLabels[s.signal] ?? s.signal).join(', ')}`
      : 'No signals classified as fully causal yet.',
    spurious.length > 0
      ? `Spurious (regime-dependent): ${spurious.map(s => signalLabels[s.signal] ?? s.signal).join(', ')}`
      : 'No signals classified as spurious.',
  ].join(' ');
}
