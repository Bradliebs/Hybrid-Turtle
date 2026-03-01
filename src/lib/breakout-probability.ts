/**
 * DEPENDENCIES
 * Consumed by: /api/scan/cross-ref/route.ts, /api/backtest/route.ts,
 *              ReadyToBuyPanel.tsx (via cross-ref response)
 * Consumes: sector-etf-cache.ts (optional — for sector momentum factor)
 * Risk-sensitive: NO — read-only scoring, no position sizing or gate logic
 * Last modified: 2026-03-01
 * Notes: BPS (Breakout Probability Score) is a supplementary 0–19 score
 *        that sits alongside NCS/BQS/FWS. It does NOT replace them.
 *        Higher BPS = more structural evidence for a clean breakout.
 *        Factor 1 uses ATR compression ratio (currentATR / atr20BarsAgo)
 *        instead of absolute ATR%. Snapshot-based callers degrade gracefully
 *        to 0 for Factor 1 until schema is extended with atr_compression_ratio.
 */

import { getSectorMomentum } from './sector-etf-cache';

// ── Types ────────────────────────────────────────────────────

/** Input data for BPS calculation. All fields nullable for resilience. */
export interface BPSInput {
  /** ATR compression ratio: currentATR / atr20BarsAgo. <1 = contracting, >1 = expanding */
  atrCompressionRatio?: number | null;
  /** @deprecated — replaced by atrCompressionRatio. Kept for backward compat; ignored by Factor 1. */
  atrPct?: number | null;
  /** 20-day volume bars (most recent first) for accumulation slope */
  volumeBars?: number[] | null;
  /** Relative strength vs benchmark (e.g. +5 means 5% outperformance) */
  rsVsBenchmarkPct?: number | null;
  /** Sector name or ETF ticker for sector momentum lookup */
  sector?: string | null;
  /** Number of consecutive days price has been within 10% of the 20-day high */
  consolidationDays?: number | null;
  /** Weekly ADX value — fallback for Factor 6 when priorTrendReturn unavailable */
  weeklyAdx?: number | null;
  /** 12-week (60-bar) lookback return %. Preferred input for Factor 6. */
  priorTrendReturn?: number | null;
  /** Date of most recent failed breakout (null = none) */
  failedBreakoutAt?: Date | null;
  /** Current date for failed-breakout age calculation (defaults to now) */
  now?: Date;
  /** Pre-computed RS percentile rank (0–100) across the candidate universe.
   *  When provided, Factor 3 uses cross-sectional ranking instead of fixed thresholds. */
  rsPercentile?: number | null;
}

/** Per-factor breakdown of the BPS score */
export interface BPSComponents {
  /** Consolidation Quality (0–3): ATR compression ratio — lower ratio = tighter coil */
  consolidationQuality: number;
  /** Volume Accumulation Slope (0–3): positive linear regression slope = accumulation */
  volumeAccumulation: number;
  /** Relative Strength Rank (0–3): stronger RS vs benchmark = higher */
  rsRank: number;
  /** Sector Momentum (0–2): sector ETF positive return = tailwind */
  sectorMomentum: number;
  /** Consolidation Duration (0–3): sweet spot 10–30 days */
  consolidationDuration: number;
  /** Prior Trend Strength (0–3): 12-week return or weekly ADX fallback */
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
 * Measures ATR compression — has the stock's daily range contracted
 * relative to 20 bars ago? Lower ratio = tighter consolidation coil.
 *
 * ratio = currentATR / atr20BarsAgo
 *   < 0.6  → 3 (strongly contracted — tight coil)
 *   0.6–0.8 → 2 (moderately contracted)
 *   0.8–1.0 → 1 (slightly contracted)
 *   > 1.0  → 0 (expanding volatility — not consolidating)
 */
function scoreConsolidationQuality(ratio: number | null | undefined): number {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio < 0.6) return 3;
  if (ratio < 0.8) return 2;
  if (ratio < 1.0) return 1;
  return 0;
}

/**
 * Factor 2: Volume Accumulation Slope (0–3)
 * Positive slope on last 10 volume bars = institutional accumulation.
 * 10-day window is more responsive to recent accumulation than 20-day.
 * The slope is normalised by the mean volume to make it comparable
 * across different price/volume scales.
 *
 * Normalised slope > 0.03 = 3 (strong), > 0.01 = 2 (moderate),
 * > 0 = 1 (slight positive), <= 0 = 0 (distribution or flat)
 */
function scoreVolumeAccumulation(volumeBars: number[] | null | undefined): number {
  if (!volumeBars || volumeBars.length < 10) return 0;

  // Use 10 most recent bars — responsive to recent accumulation patterns
  const bars = volumeBars.slice(0, 10);
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
 * Prefers cross-sectional percentile ranking when rsPercentile is available.
 * Top 10% = 3, top 25% = 2, top 50% = 1, bottom 50% = 0.
 * Falls back to fixed thresholds on rsVsBenchmarkPct when no percentile data.
 */
function scoreRsRank(
  rsPct: number | null | undefined,
  rsPercentile: number | null | undefined,
): number {
  // Prefer universe-relative percentile ranking when available
  if (rsPercentile != null && Number.isFinite(rsPercentile)) {
    if (rsPercentile >= 90) return 3;
    if (rsPercentile >= 75) return 2;
    if (rsPercentile >= 50) return 1;
    return 0;
  }
  // Fallback: fixed thresholds (e.g. early-bird where universe data unavailable)
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
 * Number of days price has been within 10% of the 20-day high.
 * Sweet spot is 15–45 bars: enough time to build a proper base,
 * not so long it suggests the stock is stuck.
 * 15–45 bars = 3 (ideal), 8–14 bars = 1 (short base),
 * > 45 bars = 1 (stale base), < 8 bars = 0 (no base)
 */
function scoreConsolidationDuration(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days) || days < 8) return 0;
  if (days >= 15 && days <= 45) return 3;
  // Short base (8–14) or stale base (>45)
  return 1;
}

/**
 * Factor 6: Prior Trend Strength (0–3)
 * Prefers 12-week (60-bar) lookback return when available — measures how much
 * stored energy the stock built before consolidating.
 *   > 20% = 3 (strong prior trend)
 *   10–20% = 2 (moderate)
 *   5–10% = 1 (mild)
 *   < 5% = 0 (no meaningful prior trend)
 * Falls back to weekly ADX when 12-week return not available (snapshot callers).
 */
function scorePriorTrend(
  priorTrendReturn: number | null | undefined,
  weeklyAdx: number | null | undefined,
): number {
  // Prefer 12-week lookback return when available
  if (priorTrendReturn != null && Number.isFinite(priorTrendReturn)) {
    if (priorTrendReturn > 20) return 3;
    if (priorTrendReturn >= 10) return 2;
    if (priorTrendReturn >= 5) return 1;
    return 0;
  }
  // Fallback: weekly ADX (direction-agnostic proxy)
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
 * No failed breakout ever = 2 (clean), > 30 days ago = 1 (faded),
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

  if (daysSince > 30) return 1;
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
    consolidationQuality: scoreConsolidationQuality(input.atrCompressionRatio),
    volumeAccumulation: scoreVolumeAccumulation(input.volumeBars),
    rsRank: scoreRsRank(input.rsVsBenchmarkPct, input.rsPercentile),
    sectorMomentum: scoreSectorMomentum(input.sector),
    consolidationDuration: scoreConsolidationDuration(input.consolidationDays),
    priorTrend: scorePriorTrend(input.priorTrendReturn, input.weeklyAdx),
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
  atr_compression_ratio?: number | null;
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
  // Pre-computed RS percentile (0–100) from universe — enables cross-sectional ranking
  rsPercentile?: number | null;
  // 12-week lookback return % — preferred for Factor 6 (prior trend strength)
  priorTrendReturn?: number | null;
}): BPSResult {
  return calcBPS({
    atrCompressionRatio: row.atr_compression_ratio ?? undefined,
    atrPct: row.atr_pct ?? undefined,
    volumeBars: row.volumeBars ?? undefined,
    rsVsBenchmarkPct: row.rs_vs_benchmark_pct ?? undefined,
    rsPercentile: row.rsPercentile ?? undefined,
    sector: row.sector ?? row.cluster_name ?? undefined,
    consolidationDays: row.consolidationDays ?? undefined,
    weeklyAdx: row.weekly_adx ?? undefined,
    priorTrendReturn: row.priorTrendReturn ?? undefined,
    failedBreakoutAt: row.failedBreakoutAt ?? undefined,
  });
}

// ── RS Percentile Helper ─────────────────────────────────────

/**
 * Compute percentile ranks for RS values across a universe of tickers.
 * Returns a Map of ticker → percentile (0–100, higher = stronger RS).
 * Uses the "percentage of values below" method:
 *   percentile = (count of tickers with RS < this ticker's RS) / (total - 1) * 100
 */
export function computeRsPercentiles(
  tickers: { ticker: string; rs: number }[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (tickers.length <= 1) {
    // Single ticker or empty — assign 50th percentile (neutral)
    for (const t of tickers) result.set(t.ticker, 50);
    return result;
  }

  // Sort ascending by RS
  const sorted = [...tickers].sort((a, b) => a.rs - b.rs);
  const n = sorted.length;

  for (let i = 0; i < n; i++) {
    // Handle ties: all tickers with the same RS get the same percentile
    // Count how many tickers have strictly lower RS
    let belowCount = i;
    // Walk back for ties
    while (belowCount > 0 && sorted[belowCount - 1].rs === sorted[i].rs) {
      belowCount--;
    }
    const percentile = Math.round((belowCount / (n - 1)) * 100);
    result.set(sorted[i].ticker, percentile);
  }

  return result;
}
