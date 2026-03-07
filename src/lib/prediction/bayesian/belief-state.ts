/**
 * DEPENDENCIES
 * Consumed by: bayesian-updater.ts, belief-informed-weights.ts, /api/prediction/beliefs/route.ts
 * Consumes: prisma.ts
 * Risk-sensitive: NO — stores and queries belief distributions only
 * Last modified: 2026-03-07
 * Notes: Maintains Beta(α, β) distributions per (signal, regime) pair.
 *        7 signals × 4 regimes = 28 distributions.
 *        Prior: Beta(2, 2) — weakly uninformative, centred at 0.5.
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────

export type SignalId = 'adx' | 'di' | 'hurst' | 'bis' | 'drs' | 'weeklyAdx' | 'bps';
export type RegimeId = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'TRANSITION';

export const SIGNAL_IDS: SignalId[] = ['adx', 'di', 'hurst', 'bis', 'drs', 'weeklyAdx', 'bps'];
export const REGIME_IDS: RegimeId[] = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];

export const SIGNAL_LABELS: Record<SignalId, string> = {
  adx: 'Trend (ADX)',
  di: 'Direction (DI)',
  hurst: 'Persistence (Hurst)',
  bis: 'Candle Quality (BIS)',
  drs: 'Market Regime (DRS)',
  weeklyAdx: 'Weekly Trend',
  bps: 'Setup Quality (BPS)',
};

export interface SignalBelief {
  signal: SignalId;
  regime: RegimeId;
  alpha: number;
  beta: number;
  mean: number;                   // α / (α + β)
  credibleIntervalLow: number;   // 5th percentile of Beta
  credibleIntervalHigh: number;  // 95th percentile of Beta
  nObservations: number;          // α + β - 4 (subtract prior pseudo-counts)
}

/** Default prior: Beta(2, 2) — centred at 0.5, weakly uninformative */
const PRIOR_ALPHA = 2;
const PRIOR_BETA = 2;

// ── Beta Distribution Helpers ────────────────────────────────

/**
 * Compute the mean of a Beta(α, β) distribution.
 */
function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Approximate the p-th quantile of a Beta distribution.
 * Uses the normal approximation for Beta when α, β > 1.
 * For small α, β falls back to a simpler estimate.
 */
function betaQuantile(alpha: number, beta: number, p: number): number {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const std = Math.sqrt(variance);

  // Normal approximation: quantile ≈ mean + z × std
  // z for p=0.05 ≈ -1.645, z for p=0.95 ≈ +1.645
  const z = p < 0.5
    ? -Math.sqrt(-2 * Math.log(2 * p))  // rough inverse normal CDF
    : Math.sqrt(-2 * Math.log(2 * (1 - p)));

  return Math.max(0, Math.min(1, mean + z * std));
}

/**
 * Build a SignalBelief from raw α, β values.
 */
export function buildBelief(signal: SignalId, regime: RegimeId, alpha: number, beta: number): SignalBelief {
  return {
    signal,
    regime,
    alpha,
    beta,
    mean: Math.round(betaMean(alpha, beta) * 1000) / 1000,
    credibleIntervalLow: Math.round(betaQuantile(alpha, beta, 0.05) * 1000) / 1000,
    credibleIntervalHigh: Math.round(betaQuantile(alpha, beta, 0.95) * 1000) / 1000,
    nObservations: Math.max(0, alpha + beta - PRIOR_ALPHA - PRIOR_BETA),
  };
}

// ── Persistence ──────────────────────────────────────────────

/**
 * Seed all 28 belief states with the prior Beta(2,2) if they don't exist.
 */
export async function seedBeliefStates(): Promise<number> {
  let seeded = 0;
  for (const signal of SIGNAL_IDS) {
    for (const regime of REGIME_IDS) {
      const existing = await prisma.signalBeliefState.findFirst({
        where: { signal, regime },
      });
      if (!existing) {
        await prisma.signalBeliefState.create({
          data: { signal, regime, alpha: PRIOR_ALPHA, beta: PRIOR_BETA },
        });
        seeded++;
      }
    }
  }
  return seeded;
}

/**
 * Get all current belief states (28 entries).
 */
export async function getAllBeliefs(): Promise<SignalBelief[]> {
  await seedBeliefStates();

  const rows = await prisma.signalBeliefState.findMany({
    orderBy: [{ signal: 'asc' }, { regime: 'asc' }],
  });

  return rows.map(r =>
    buildBelief(r.signal as SignalId, r.regime as RegimeId, r.alpha, r.beta)
  );
}

/**
 * Get belief for a specific (signal, regime) pair.
 */
export async function getBelief(signal: SignalId, regime: RegimeId): Promise<SignalBelief> {
  await seedBeliefStates();

  const row = await prisma.signalBeliefState.findFirst({
    where: { signal, regime },
  });

  if (!row) {
    return buildBelief(signal, regime, PRIOR_ALPHA, PRIOR_BETA);
  }

  return buildBelief(signal, regime, row.alpha, row.beta);
}

/**
 * Get beliefs for a specific regime (7 signals).
 */
export async function getBeliefsByRegime(regime: RegimeId): Promise<SignalBelief[]> {
  await seedBeliefStates();

  const rows = await prisma.signalBeliefState.findMany({
    where: { regime },
    orderBy: { signal: 'asc' },
  });

  return rows.map(r =>
    buildBelief(r.signal as SignalId, r.regime as RegimeId, r.alpha, r.beta)
  );
}

/**
 * Update a belief state (called by bayesian-updater after trade closes).
 */
export async function updateBelief(
  signal: SignalId,
  regime: RegimeId,
  success: boolean
): Promise<SignalBelief> {
  await seedBeliefStates();

  const row = await prisma.signalBeliefState.findFirst({
    where: { signal, regime },
  });

  const currentAlpha = row?.alpha ?? PRIOR_ALPHA;
  const currentBeta = row?.beta ?? PRIOR_BETA;

  const newAlpha = success ? currentAlpha + 1 : currentAlpha;
  const newBeta = success ? currentBeta : currentBeta + 1;

  if (row) {
    await prisma.signalBeliefState.update({
      where: { id: row.id },
      data: { alpha: newAlpha, beta: newBeta, updatedAt: new Date() },
    });
  }

  return buildBelief(signal, regime, newAlpha, newBeta);
}
