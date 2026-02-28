/**
 * DEPENDENCIES
 * Consumed by: /api/scan/cross-ref/route.ts, /api/backtest/route.ts,
 *              ReadyToBuyPanel.tsx (via cross-ref response)
 * Consumes: sector-etf-cache.ts (optional — for sector momentum factor)
 * Risk-sensitive: NO — read-only scoring, no position sizing or gate logic
 * Last modified: 2026-02-28
 * Notes: BPS (Breakout Probability Score) is a supplementary 0–19 score
 *        that sits alongside NCS/BQS/FWS. It does NOT replace them.
 *        Higher BPS = more structural evidence for a clean breakout.
 */

import { getSectorMomentum } from './sector-etf-cache';

// ── Types ────────────────────────────────────────────────────

/** Input data for BPS calculation. All fields nullable for resilience. */
export interface BPSInput {
  /** ATR as percentage of price (e.g. 2.5 means 2.5%) */
  atrPct?: number | null;
  /** 20-day volume bars (most recent first) for accumulation slope */
  volumeBars?: number[] | null;
  /** Relative strength vs benchmark (e.g. +5 means 5% outperformance) */
  rsVsBenchmarkPct?: number | null;
  /** Sector name or ETF ticker for sector momentum lookup */
  sector?: string | null;
  /** Number of consecutive days price has been within 5% of the 20-day high */
  consolidationDays?: number | null;
  /** Weekly ADX value */
  weeklyAdx?: number | null;
  /** Date of most recent failed breakout (null = none) */
  failedBreakoutAt?: Date | null;
  /** Current date for failed-breakout age calculation (defaults to now) */
  now?: Date;
}

/** Per-factor breakdown of the BPS score */
export interface BPSComponents {
  /** Consolidation Quality (0–3): tighter ATR% = higher */
  consolidationQuality: number;
  /** Volume Accumulation Slope (0–3): positive linear regression slope = accumulation */
  volumeAccumulation: number;
  /** Relative Strength Rank (0–3): stronger RS vs benchmark = higher */
  rsRank: number;
  /** Sector Momentum (0–2): sector ETF positive return = tailwind */
  sectorMomentum: number;
  /** Consolidation Duration (0–3): sweet spot 10–30 days */
  consolidationDuration: number;
  /** Prior Trend Strength (0–3): weekly ADX confirms higher-TF trend */
  priorTrend: number;
  /** Failed Breakout Penalty (0–2): no recent failure = full credit */
  failedBreakout: number;
}

/** Full BPS result */
export interface BPSResult {
  /** Composite score 0–19 */
  bps: number;
  /** Per-factor breakdown */
  components: BPSComponents;
}

// ── Linear Regression ────────────────────────────────────────

/**
 * Compute the slope of a simple linear regression (OLS) on an array of values.
 * x = [0, 1, 2, ..., n-1], y = values.
 *
 * slope = (n * Σ(x*y) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
 *
 * Returns 0 for empty or single-element arrays.
 * Values array is expected newest-first (index 0 = most recent),
 * so we reverse internally to get chronological order for the regression.
 */
export function linearRegressionSlope(values: number[]): number {
  if (!values || values.length < 2) return 0;

  // Reverse to chronological order (oldest first)
  const y = [...values].reverse();
  const n = y.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const val = y[i];
    if (!Number.isFinite(val)) return 0; // bail on NaN/Infinity
    sumX += i;
    sumY += val;
    sumXY += i * val;
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

// ── Factor Scoring Functions ─────────────────────────────────

/**
 * Factor 1: Consolidation Quality (0–3)
 * Tighter price range (lower ATR%) = higher quality consolidation.
 * ATR% < 2% = 3 (very tight), < 3% = 2 (decent), < 4% = 1 (acceptable), >= 4% = 0
 */
function scoreConsolidationQuality(atrPct: number | null | undefined): number {
  if (atrPct == null || !Number.isFinite(atrPct)) return 0;
  if (atrPct < 2) return 3;
  if (atrPct < 3) return 2;
  if (atrPct < 4) return 1;
  return 0;
}

/**
 * Factor 2: Volume Accumulation Slope (0–3)
 * Positive slope on last 20 volume bars = institutional accumulation.
 * The slope is normalised by the mean volume to make it comparable
 * across different price/volume scales.
 *
 * Normalised slope > 0.03 = 3 (strong), > 0.01 = 2 (moderate),
 * > 0 = 1 (slight positive), <= 0 = 0 (distribution or flat)
 */
function scoreVolumeAccumulation(volumeBars: number[] | null | undefined): number {
  if (!volumeBars || volumeBars.length < 5) return 0;

  // Use up to 20 most recent bars
  const bars = volumeBars.slice(0, 20);
  const slope = linearRegressionSlope(bars);

  // Normalise slope by mean volume to get a scale-independent ratio
  const mean = bars.reduce((s, v) => s + v, 0) / bars.length;
  if (mean <= 0) return 0;

  const normSlope = slope / mean;

  if (normSlope > 0.03) return 3;
  if (normSlope > 0.01) return 2;
  if (normSlope > 0) return 1;
  return 0;
}

/**
 * Factor 3: RS Rank (0–3)
 * How much the stock is outperforming its benchmark.
 * > 10% = 3 (strong leader), > 5% = 2 (outperformer),
 * > 0% = 1 (slight edge), <= 0% = 0 (laggard)
 */
function scoreRsRank(rsPct: number | null | undefined): number {
  if (rsPct == null || !Number.isFinite(rsPct)) return 0;
  if (rsPct > 10) return 3;
  if (rsPct > 5) return 2;
  if (rsPct > 0) return 1;
  return 0;
}

/**
 * Factor 4: Sector Momentum (0–2)
 * Uses cached sector ETF 20-day return from nightly.
 * > 3% = 2 (strong sector tailwind), > 0% = 1 (positive), <= 0% = 0 (headwind)
 */
function scoreSectorMomentum(sector: string | null | undefined): number {
  if (!sector) return 0;

  const momentum = getSectorMomentum(sector);
  if (momentum == null) return 0; // no data — neutral

  if (momentum > 3) return 2;
  if (momentum > 0) return 1;
  return 0;
}

/**
 * Factor 5: Consolidation Duration (0–3)
 * Number of days price has been within 5% of the 20-day high.
 * Sweet spot is 10–30 days: enough time to build a base, not so long
 * it suggests the stock is stuck.
 * 10–30 days = 3 (ideal), 5–10 or 30–50 = 2 (acceptable),
 * 3–5 or 50–70 = 1 (marginal), else 0
 */
function scoreConsolidationDuration(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days) || days <= 0) return 0;
  if (days >= 10 && days <= 30) return 3;
  if ((days >= 5 && days < 10) || (days > 30 && days <= 50)) return 2;
  if ((days >= 3 && days < 5) || (days > 50 && days <= 70)) return 1;
  return 0;
}

/**
 * Factor 6: Prior Trend Strength (0–3)
 * Weekly ADX confirms the stock has an established trend on a higher timeframe.
 * >= 30 = 3 (strong trend), >= 25 = 2 (moderate), >= 20 = 1 (emerging), < 20 = 0
 */
function scorePriorTrend(weeklyAdx: number | null | undefined): number {
  if (weeklyAdx == null || !Number.isFinite(weeklyAdx)) return 0;
  if (weeklyAdx >= 30) return 3;
  if (weeklyAdx >= 25) return 2;
  if (weeklyAdx >= 20) return 1;
  return 0;
}

/**
 * Factor 7: Failed Breakout History (0–2)
 * Absence of a recent failed breakout is a positive signal — means the
 * stock hasn't faked out buyers recently.
 * No failed breakout ever / > 30 days ago = 2 (clean),
 * 10–30 days ago = 1 (fading memory), < 10 days ago = 0 (recent failure — caution)
 */
function scoreFailedBreakout(
  failedAt: Date | null | undefined,
  now: Date = new Date()
): number {
  if (!failedAt) return 2; // no failed breakout = full credit

  const daysSince = Math.floor(
    (now.getTime() - failedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince > 30) return 2;
  if (daysSince >= 10) return 1;
  return 0;
}

// ── Main BPS Calculator ─────────────────────────────────────

/**
 * Calculate the Breakout Probability Score (BPS).
 *
 * Pure function — all inputs passed in, no side effects.
 * Returns a score 0–19 and per-factor breakdown.
 */
export function calcBPS(input: BPSInput): BPSResult {
  const components: BPSComponents = {
    consolidationQuality: scoreConsolidationQuality(input.atrPct),
    volumeAccumulation: scoreVolumeAccumulation(input.volumeBars),
    rsRank: scoreRsRank(input.rsVsBenchmarkPct),
    sectorMomentum: scoreSectorMomentum(input.sector),
    consolidationDuration: scoreConsolidationDuration(input.consolidationDays),
    priorTrend: scorePriorTrend(input.weeklyAdx),
    failedBreakout: scoreFailedBreakout(input.failedBreakoutAt, input.now),
  };

  const bps =
    components.consolidationQuality +
    components.volumeAccumulation +
    components.rsRank +
    components.sectorMomentum +
    components.consolidationDuration +
    components.priorTrend +
    components.failedBreakout;

  return { bps, components };
}

// ── Convenience: compute BPS from a SnapshotRow-like object ──

/**
 * Compute BPS from a snapshot row + optional enrichment data.
 * Falls back gracefully when fields are missing.
 */
export function calcBPSFromSnapshot(row: {
  atr_pct?: number | null;
  rs_vs_benchmark_pct?: number | null;
  weekly_adx?: number | null;
  sector?: string | null;
  cluster_name?: string | null;
  // Volume data not in SnapshotRow — pass separately
  volumeBars?: number[] | null;
  // Consolidation days not in SnapshotRow — pass separately
  consolidationDays?: number | null;
  // Failed breakout date — from TechnicalData or computed externally
  failedBreakoutAt?: Date | null;
}): BPSResult {
  return calcBPS({
    atrPct: row.atr_pct ?? undefined,
    volumeBars: row.volumeBars ?? undefined,
    rsVsBenchmarkPct: row.rs_vs_benchmark_pct ?? undefined,
    sector: row.sector ?? row.cluster_name ?? undefined,
    consolidationDays: row.consolidationDays ?? undefined,
    weeklyAdx: row.weekly_adx ?? undefined,
    failedBreakoutAt: row.failedBreakoutAt ?? undefined,
  });
}
