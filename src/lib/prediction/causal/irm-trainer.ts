/**
 * DEPENDENCIES
 * Consumed by: invariance-scores.ts, /api/prediction/invariance/route.ts
 * Consumes: environment-partitioner.ts
 * Risk-sensitive: NO — offline analysis only
 * Last modified: 2026-03-07
 * Notes: Simplified Invariant Risk Minimisation (IRM) for pure TypeScript.
 *        For each signal: fit a linear predictor (outcome ~ β × signal) in each
 *        regime environment, then measure variance of β across environments.
 *        Low variance = invariant (causal). High variance = spurious.
 *        ⛔ Does NOT modify sacred files.
 */

import {
  loadEnvironmentData,
  SIGNAL_NAMES,
  SIGNAL_COUNT,
  type EnvironmentData,
  type IRMEnvironment,
  type DataSourceMeta,
} from './environment-partitioner';

// ── Types ────────────────────────────────────────────────────

export interface SignalInvariance {
  signal: string;
  /** Invariance score: (0, 1]. 1.0 = perfectly invariant, near 0 = regime-dependent */
  invarianceScore: number;
  /** β coefficient per environment */
  betaPerEnvironment: Record<IRMEnvironment, number>;
  /** Variance of β across environments */
  betaVariance: number;
  /** Classification */
  classification: 'CAUSAL' | 'MIXED' | 'SPURIOUS';
}

export interface IRMTrainingResult {
  signals: SignalInvariance[];
  environmentsUsed: IRMEnvironment[];
  totalSamples: number;
  computedAt: Date;
  dataSource: DataSourceMeta;
}

// ── Linear Regression (OLS) ──────────────────────────────────

/**
 * Fit a simple linear regression: outcome = β × signal + intercept.
 * Returns the slope β.
 */
function fitLinearRegression(
  signals: number[],
  outcomes: number[]
): number {
  const n = signals.length;
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += signals[i];
    sumY += outcomes[i];
    sumXY += signals[i] * outcomes[i];
    sumXX += signals[i] * signals[i];
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

// ── IRM Training ─────────────────────────────────────────────

/**
 * Run the IRM analysis: for each signal, fit β in each environment,
 * then compute variance of β across environments.
 */
export async function runIRMTraining(): Promise<IRMTrainingResult> {
  const { envData, meta } = await loadEnvironmentData(10);

  if (envData.length < 2) {
    // Need at least 2 environments to measure invariance
    return {
      signals: SIGNAL_NAMES.map(s => ({
        signal: s,
        invarianceScore: 0.5, // unknown
        betaPerEnvironment: { TRENDING: 0, RANGING: 0, VOLATILE: 0, TRANSITION: 0 },
        betaVariance: 0,
        classification: 'MIXED' as const,
      })),
      environmentsUsed: envData.map(e => e.environment),
      totalSamples: envData.reduce((s, e) => s + e.samples.length, 0),
      computedAt: new Date(),
      dataSource: meta,
    };
  }

  const totalSamples = envData.reduce((s, e) => s + e.samples.length, 0);
  const signals: SignalInvariance[] = [];

  for (let si = 0; si < SIGNAL_COUNT; si++) {
    const signalName = SIGNAL_NAMES[si];

    // Fit β_s in each environment
    const betas: Record<string, number> = {};
    const betaValues: number[] = [];

    for (const env of envData) {
      const signalValues = env.samples.map(s => s.signals[si]);
      const outcomeValues = env.samples.map(s => s.outcome);

      const beta = fitLinearRegression(signalValues, outcomeValues);
      betas[env.environment] = Math.round(beta * 10000) / 10000;
      betaValues.push(beta);
    }

    // Compute variance of β across environments
    const meanBeta = betaValues.reduce((s, b) => s + b, 0) / betaValues.length;
    const betaVariance = betaValues.reduce((s, b) => s + (b - meanBeta) ** 2, 0) / betaValues.length;

    // Invariance score: 1 / (1 + variance)
    // High invariance = β is similar across all regimes
    const invarianceScore = 1 / (1 + betaVariance * 100); // scale variance for sensitivity

    // Classification
    let classification: SignalInvariance['classification'];
    if (invarianceScore >= 0.6) classification = 'CAUSAL';
    else if (invarianceScore >= 0.3) classification = 'MIXED';
    else classification = 'SPURIOUS';

    signals.push({
      signal: signalName,
      invarianceScore: Math.round(invarianceScore * 1000) / 1000,
      betaPerEnvironment: {
        TRENDING: betas['TRENDING'] ?? 0,
        RANGING: betas['RANGING'] ?? 0,
        VOLATILE: betas['VOLATILE'] ?? 0,
        TRANSITION: betas['TRANSITION'] ?? 0,
      },
      betaVariance: Math.round(betaVariance * 10000) / 10000,
      classification,
    });
  }

  // Sort by invariance score descending (most causal first)
  signals.sort((a, b) => b.invarianceScore - a.invarianceScore);

  return {
    signals,
    environmentsUsed: envData.map(e => e.environment),
    totalSamples,
    computedAt: new Date(),
    dataSource: meta,
  };
}
