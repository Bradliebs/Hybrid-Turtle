/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/stress-test/route.ts, StressTestGauge.tsx
 * Consumes: (standalone — pure math, no internal imports)
 * Risk-sensitive: NO — simulation only, no position changes
 * Last modified: 2026-03-07
 * Notes: Monte Carlo simulation adversarially biased toward failure.
 *        Generates N synthetic price paths consistent with current conditions,
 *        oversampling the tail. Counts stop-hit probability.
 *        Pure TS, no dependencies. 500 paths × 7 days runs in < 50ms.
 *        ⛔ Does NOT modify sacred files. Reads stop/ATR data only.
 */

// ── Types ────────────────────────────────────────────────────

export interface StressTestConfig {
  ticker: string;
  entryPrice: number;
  stopPrice: number;
  atr: number;
  regime: string;
  nPaths: number;         // default 500
  horizonDays: number;    // default 7
  adversarialBias: number; // 0 = neutral, 1 = maximum adversarial (default 0.6)
}

export interface StressTestResult {
  ticker: string;
  stopHitProbability: number;   // 0–1: fraction of paths hitting stop
  gate: 'PASS' | 'FAIL';
  pathsRun: number;
  horizonDays: number;
  adversarialBias: number;
  /** Percentile stats from the Monte Carlo run */
  percentiles: {
    p5: number;    // 5th percentile of final prices (worst case)
    p25: number;   // 25th percentile
    p50: number;   // median
    p75: number;   // 75th percentile
    p95: number;   // 95th percentile (best case)
  };
  /** Average days to stop hit across paths that hit (null if none hit) */
  avgDaysToStopHit: number | null;
}

// ── Gate Thresholds ──────────────────────────────────────────

export const STRESS_GATE = {
  /** Auto-Yes blocked if >25% of adversarial paths hit stop */
  autoYesMaxStopProb: 0.25,
  /** Conditional blocked if >40% */
  conditionalMaxStopProb: 0.40,
} as const;

export const DEFAULT_CONFIG: Omit<StressTestConfig, 'ticker' | 'entryPrice' | 'stopPrice' | 'atr' | 'regime'> = {
  nPaths: 500,
  horizonDays: 7,
  adversarialBias: 0.6,
};

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────
// Deterministic random for reproducibility in testing.
// In production, seed from Date.now() for true randomness.

function mulberry32(seed: number): () => number {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Box-Muller Transform ─────────────────────────────────────
// Convert uniform random to standard normal (mean=0, std=1).

function boxMuller(rand: () => number): number {
  const u1 = rand();
  const u2 = rand();
  // Guard against log(0)
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-15)));
  return r * Math.cos(2 * Math.PI * u2);
}

// ── Regime-Dependent Drift Parameters ────────────────────────
// Adversarial bias shifts drift toward the unfavourable direction.

interface DriftParams {
  /** Expected daily drift (annualized/252) */
  baseDrift: number;
  /** Jump probability per day (fat-tail events) */
  jumpProb: number;
  /** Jump magnitude in sigma terms (negative = adverse) */
  jumpMagnitude: number;
}

function getRegimeDriftParams(regime: string, adversarialBias: number): DriftParams {
  // Base drift per regime (daily, approximate)
  const regimeDrift: Record<string, number> = {
    BULLISH: 0.0004,    // ~10% annualized / 252
    SIDEWAYS: 0.0,
    BEARISH: -0.0003,
    NEUTRAL: 0.0001,
  };

  const baseDrift = regimeDrift[regime] ?? 0.0001;

  // Adversarial bias: push drift toward negative territory
  // At bias=0: use actual regime drift
  // At bias=1: use the most adverse regime drift (BEARISH)
  const adversarialDrift = baseDrift * (1 - adversarialBias) + (-0.0003) * adversarialBias;

  // Jump events: occasional -2σ to -4σ events
  // Higher adversarial bias → more frequent and larger jumps
  const jumpProb = 0.02 + adversarialBias * 0.08;     // 2–10% daily jump chance
  const jumpMagnitude = -(2 + adversarialBias * 2);    // -2σ to -4σ

  return {
    baseDrift: adversarialDrift,
    jumpProb,
    jumpMagnitude,
  };
}

// ── Path Generator ───────────────────────────────────────────

/**
 * Generate a single synthetic price path using Geometric Brownian Motion
 * with adversarial drift bias and fat-tail jump events.
 *
 * Returns array of daily closing prices (length = horizonDays).
 */
function generateAdversarialPath(
  config: StressTestConfig,
  rand: () => number
): number[] {
  const { entryPrice, atr, regime, horizonDays, adversarialBias } = config;

  // Daily volatility from ATR (ATR ≈ 1.5 × daily σ for trending assets)
  const dailyVol = atr / entryPrice / 1.5;

  const driftParams = getRegimeDriftParams(regime, adversarialBias);
  const path: number[] = [];
  let price = entryPrice;

  for (let day = 0; day < horizonDays; day++) {
    // Standard GBM step
    const z = boxMuller(rand);
    const drift = driftParams.baseDrift;
    const diffusion = dailyVol * z;

    // Fat-tail jump event
    let jump = 0;
    if (rand() < driftParams.jumpProb) {
      // Jump is negative (adverse) with magnitude proportional to sigma
      jump = driftParams.jumpMagnitude * dailyVol;
    }

    // GBM: S(t+1) = S(t) × exp(drift - 0.5σ² + σZ + jump)
    const logReturn = drift - 0.5 * dailyVol * dailyVol + diffusion + jump;
    price = price * Math.exp(logReturn);

    // Floor at 0.01 to prevent negative prices
    price = Math.max(price, 0.01);
    path.push(price);
  }

  return path;
}

// ── Percentile Calculation ───────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

// ── Main Simulator ───────────────────────────────────────────

/**
 * Run the adversarial stress test for a given trade configuration.
 * Pure computation — no side effects, no DB access.
 */
export function runAdversarialTest(config: StressTestConfig): StressTestResult {
  const { ticker, stopPrice, nPaths, horizonDays, adversarialBias } = config;
  const rand = mulberry32(Date.now());

  let stopHits = 0;
  let totalDaysToHit = 0;
  const finalPrices: number[] = [];

  for (let i = 0; i < nPaths; i++) {
    const path = generateAdversarialPath(config, rand);
    finalPrices.push(path[path.length - 1]);

    // Check if any price in the path hits the stop
    let hitDay: number | null = null;
    for (let d = 0; d < path.length; d++) {
      if (path[d] <= stopPrice) {
        hitDay = d + 1;
        break;
      }
    }

    if (hitDay !== null) {
      stopHits++;
      totalDaysToHit += hitDay;
    }
  }

  const stopHitProbability = stopHits / nPaths;
  const gate = stopHitProbability > STRESS_GATE.autoYesMaxStopProb ? 'FAIL' : 'PASS';

  // Percentile stats
  const sorted = [...finalPrices].sort((a, b) => a - b);

  return {
    ticker,
    stopHitProbability: Math.round(stopHitProbability * 1000) / 1000,
    gate,
    pathsRun: nPaths,
    horizonDays,
    adversarialBias,
    percentiles: {
      p5: Math.round(percentile(sorted, 5) * 100) / 100,
      p25: Math.round(percentile(sorted, 25) * 100) / 100,
      p50: Math.round(percentile(sorted, 50) * 100) / 100,
      p75: Math.round(percentile(sorted, 75) * 100) / 100,
      p95: Math.round(percentile(sorted, 95) * 100) / 100,
    },
    avgDaysToStopHit: stopHits > 0 ? Math.round((totalDaysToHit / stopHits) * 10) / 10 : null,
  };
}

/**
 * Classify the stress test result for display purposes.
 */
export function classifyStressResult(prob: number): 'LOW_RISK' | 'MODERATE_RISK' | 'HIGH_RISK' {
  if (prob <= 0.15) return 'LOW_RISK';
  if (prob <= STRESS_GATE.autoYesMaxStopProb) return 'MODERATE_RISK';
  return 'HIGH_RISK';
}
