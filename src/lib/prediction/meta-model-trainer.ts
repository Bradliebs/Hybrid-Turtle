/**
 * DEPENDENCIES
 * Consumed by: nightly.ts (weekly run), /api/prediction/signal-weights/route.ts (manual trigger)
 * Consumes: signal-weight-meta-model.ts, prisma.ts
 * Risk-sensitive: NO — offline analysis, no position changes
 * Last modified: 2026-03-07
 * Notes: Trains signal weight model from historical score → outcome data.
 *        Phase 1: stores weight snapshots for audit only (rule-based weights).
 *        Phase 2 (future): when 100+ calibrated outcomes, trains a small
 *        decision tree on context → optimal weights. Falls back to rule-based
 *        if insufficient data.
 *        Runs weekly (Sunday) in the nightly pipeline.
 */

import { prisma } from '@/lib/prisma';
import {
  computeSignalWeights,
  DEFAULT_WEIGHTS,
  type SignalWeights,
  type SignalWeightResult,
} from './signal-weight-meta-model';

// ── Constants ────────────────────────────────────────────────

/** Minimum calibrated outcomes before learning kicks in */
const MIN_OUTCOMES_FOR_LEARNING = 100;

/** How often to retrain (checked by shouldRetrain) */
const RETRAIN_INTERVAL_DAYS = 7;

// ── Training Result ──────────────────────────────────────────

export interface TrainingResult {
  trained: boolean;
  source: 'rule_based' | 'learned';
  outcomeCount: number;
  reason?: string;
}

// ── Core Training Pipeline ───────────────────────────────────

/**
 * Check if the model should retrain (weekly cadence).
 */
export async function shouldRetrain(): Promise<boolean> {
  const latest = await prisma.signalWeightRecord.findFirst({
    orderBy: { computedAt: 'desc' },
  });

  if (!latest) return true;

  const ageMs = Date.now() - latest.computedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= RETRAIN_INTERVAL_DAYS;
}

/**
 * Run the training pipeline:
 * 1. Check if enough outcomes exist for learning
 * 2. If not, use rule-based weights
 * 3. Store the current weight snapshot for audit
 */
export async function runTraining(force = false): Promise<TrainingResult> {
  if (!force) {
    const eligible = await shouldRetrain();
    if (!eligible) {
      return {
        trained: false,
        source: 'rule_based',
        outcomeCount: 0,
        reason: 'Retrain interval not reached',
      };
    }
  }

  // Count calibrated outcomes
  const outcomeCount = await prisma.candidateOutcome.count({
    where: { enrichedAt: { not: null } },
  });

  let weightResult: SignalWeightResult;

  if (outcomeCount >= MIN_OUTCOMES_FOR_LEARNING) {
    // Phase 2 future: run learning algorithm here
    // For now, still use rule-based but log that we COULD learn
    console.log(`[MetaModel] ${outcomeCount} outcomes available — learning not yet implemented, using rule-based`);
    weightResult = await computeSignalWeights();
    weightResult.source = 'rule_based'; // Will become 'learned' when Phase 2 learning is added
  } else {
    weightResult = await computeSignalWeights();
  }

  // Persist the weight snapshot
  await saveWeightRecord(weightResult);

  return {
    trained: true,
    source: weightResult.source,
    outcomeCount,
  };
}

// ── Persistence ──────────────────────────────────────────────

async function saveWeightRecord(result: SignalWeightResult): Promise<void> {
  await prisma.signalWeightRecord.create({
    data: {
      regime: result.context.regime,
      vixLevel: result.context.vixLevel,
      vixPercentile: result.context.vixPercentile,
      source: result.source,
      wAdx: result.weights.adx,
      wDi: result.weights.di,
      wHurst: result.weights.hurst,
      wBis: result.weights.bis,
      wDrs: result.weights.drs,
      wWeeklyAdx: result.weights.weeklyAdx,
      wBps: result.weights.bps,
    },
  });
}

/**
 * Get the latest stored weight record.
 * Returns null if no weights have been computed yet.
 */
export async function getLatestWeightRecord(): Promise<{
  weights: SignalWeights;
  regime: string;
  source: string;
  computedAt: Date;
} | null> {
  const latest = await prisma.signalWeightRecord.findFirst({
    orderBy: { computedAt: 'desc' },
  });

  if (!latest) return null;

  return {
    weights: {
      adx: latest.wAdx,
      di: latest.wDi,
      hurst: latest.wHurst,
      bis: latest.wBis,
      drs: latest.wDrs,
      weeklyAdx: latest.wWeeklyAdx,
      bps: latest.wBps,
    },
    regime: latest.regime,
    source: latest.source,
    computedAt: latest.computedAt,
  };
}
