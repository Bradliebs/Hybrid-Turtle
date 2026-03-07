/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/calibrate/route.ts, nightly.ts
 * Consumes: market-data.ts, dual-score.ts (READ ONLY), conformal-calibrator.ts, conformal-store.ts, prisma.ts
 * Risk-sensitive: NO — generates calibration data from historical prices, no position changes
 * Last modified: 2026-03-07
 * Notes: Generates synthetic residuals from Yahoo Finance historical data.
 *        For each sampled ticker, fetches 6 months of daily OHLCV, computes NCS
 *        at historical "Tuesday" dates, compares to N-day forward returns.
 *        ⛔ Does NOT modify dual-score.ts or scan-engine.ts — read-only consumer.
 */

import { getDailyPrices, getMarketRegime } from '@/lib/market-data';
import { scoreRow, type SnapshotRow } from '@/lib/dual-score';
import {
  computeQHat,
  computeAsymmetricQHats,
} from './conformal-calibrator';
import { saveCalibration, shouldRecalibrate } from './conformal-store';
import { prisma } from '@/lib/prisma';

// ── Constants ────────────────────────────────────────────────

/** Number of tickers to sample for bootstrap (trade-off: speed vs accuracy) */
const SAMPLE_SIZE = 60;

/** Forward return horizon in trading days */
const FORWARD_DAYS = 10;

/** Coverage levels to calibrate */
const COVERAGE_LEVELS = [0.80, 0.90, 0.95];

/** Minimum residuals needed for meaningful calibration */
const MIN_RESIDUALS = 50;

/** Minimum candles needed for indicator calculation (ADX needs 28, MA200 needs 200) */
const MIN_CANDLES_FOR_INDICATORS = 200;

// ── Technical Indicator Helpers ──────────────────────────────
// Simplified inline calculations to build SnapshotRow from historical OHLCV
// without importing from scan-engine (which we must not modify).

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function computeATR(bars: DailyBar[], period = 14): number {
  if (bars.length < period + 1) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      bars[i - 1].high - bars[i - 1].low,
      Math.abs(bars[i - 1].high - bars[i].close),
      Math.abs(bars[i - 1].low - bars[i].close)
    );
    atr += tr;
  }
  return atr / period;
}

function computeSMA(bars: DailyBar[], period: number): number {
  if (bars.length < period) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += bars[i].close;
  return sum / period;
}

function computeADXFromBars(bars: DailyBar[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  // Simplified ADX computation — needs at least 2*period+1 bars
  const minBars = 2 * period + 1;
  if (bars.length < minBars) return { adx: 0, plusDI: 0, minusDI: 0 };

  // Bars are newest-first from Yahoo, reverse for chronological
  const chrono = [...bars].reverse();

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < chrono.length; i++) {
    const high = chrono[i].high;
    const low = chrono[i].low;
    const prevClose = chrono[i - 1].close;
    const prevHigh = chrono[i - 1].high;
    const prevLow = chrono[i - 1].low;

    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder's smoothing
  let smoothTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < trueRanges.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trueRanges[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];

    const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };

  // Smooth DX to get ADX
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  // Final +DI and -DI
  const finalPlusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const finalMinusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

  return { adx, plusDI: finalPlusDI, minusDI: finalMinusDI };
}

function computeVolumeRatio(bars: DailyBar[], index: number, lookback = 20): number {
  if (index + lookback >= bars.length) return 1;
  const avgVol = bars.slice(index + 1, index + 1 + lookback).reduce((s, b) => s + b.volume, 0) / lookback;
  return avgVol > 0 ? bars[index].volume / avgVol : 1;
}

function highest(bars: DailyBar[], start: number, count: number): number {
  let max = -Infinity;
  for (let i = start; i < Math.min(start + count, bars.length); i++) {
    if (bars[i].high > max) max = bars[i].high;
  }
  return max;
}

// ── Build SnapshotRow from Historical Point ──────────────────

function buildSnapshotRow(
  ticker: string,
  bars: DailyBar[],
  dateIndex: number,
  regime: string
): SnapshotRow | null {
  // Need enough history behind this date for indicators
  if (dateIndex + MIN_CANDLES_FOR_INDICATORS >= bars.length) return null;

  // Subset bars from dateIndex onward (newest-first ordering preserved)
  const histSlice = bars.slice(dateIndex);

  const close = bars[dateIndex].close;
  if (!close || close <= 0) return null;

  const ma200 = computeSMA(histSlice, 200);
  if (ma200 <= 0) return null;

  const atr14 = computeATR(histSlice, 14);
  const { adx, plusDI, minusDI } = computeADXFromBars(histSlice, 14);
  const volRatio = computeVolumeRatio(bars, dateIndex, 20);
  const high20 = highest(bars, dateIndex, 20);
  const high55 = highest(bars, dateIndex, 55);
  const entryTrigger = high20;
  const stopLevel = entryTrigger - atr14 * 1.5;

  const distTo20High = high20 > 0 ? ((high20 - close) / close) * 100 : 0;
  const distTo55High = high55 > 0 ? ((high55 - close) / close) * 100 : 0;

  return {
    ticker,
    name: ticker,
    sleeve: 'CORE',
    status: distTo20High <= 2 ? 'READY' : distTo20High <= 3 ? 'WATCH' : 'FAR',
    close,
    atr_14: atr14,
    atr_pct: close > 0 ? (atr14 / close) * 100 : 0,
    adx_14: adx,
    plus_di: plusDI,
    minus_di: minusDI,
    vol_ratio: volRatio,
    market_regime: regime,
    market_regime_stable: true,
    high_20: high20,
    high_55: high55,
    distance_to_20d_high_pct: distTo20High,
    distance_to_55d_high_pct: distTo55High,
    entry_trigger: entryTrigger,
    stop_level: stopLevel,
    chasing_20_last5: false,
    chasing_55_last5: false,
    atr_spiking: false,
    atr_collapsing: false,
    rs_vs_benchmark_pct: 0,
  };
}

// ── Forward Return to Outcome-Implied NCS ────────────────────

/**
 * Map a forward return to an "outcome-implied NCS" using percentile rank.
 * Positive returns → high NCS, negative → low NCS.
 */
function forwardReturnToImpliedNCS(
  forwardReturn: number,
  allReturns: number[]
): number {
  if (allReturns.length === 0) return 50;
  const sorted = [...allReturns].sort((a, b) => a - b);
  // Find percentile rank
  let rank = 0;
  for (const r of sorted) {
    if (r <= forwardReturn) rank++;
    else break;
  }
  // Map percentile (0–1) to NCS scale (0–100)
  return (rank / sorted.length) * 100;
}

// ── Main Bootstrap Pipeline ──────────────────────────────────

export interface BootstrapResult {
  residuals: number[];
  sampleSize: number;
  tickersSampled: number;
  datesPerTicker: number;
  regime: string | null;
}

/**
 * Run the bootstrap calibration: fetch historical data, compute NCS scores
 * at past dates, compare to forward returns, collect residuals.
 */
export async function runBootstrapCalibration(
  regime: string | null = null
): Promise<BootstrapResult> {
  // Get active tickers from DB, sample subset for speed
  const allStocks = await prisma.stock.findMany({
    where: { active: true },
    select: { ticker: true, sleeve: true },
  });

  // Shuffle and sample
  const shuffled = [...allStocks].sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, SAMPLE_SIZE);

  // Get current regime for context
  const currentRegime = regime ?? (await getMarketRegime()) ?? 'NEUTRAL';

  const allNCSPredicted: number[] = [];
  const allForwardReturns: number[] = [];
  const pairs: Array<{ predicted: number; forwardReturn: number }> = [];

  for (const stock of sampled) {
    try {
      // Fetch 6 months of daily data (full mode = ~400 days for MA200 + history)
      const bars = await getDailyPrices(stock.ticker, 'full');
      if (!bars || bars.length < MIN_CANDLES_FOR_INDICATORS + FORWARD_DAYS + 20) continue;

      // Find Tuesday dates in the data (bars are newest-first)
      const tuesdayIndices: number[] = [];
      for (let i = FORWARD_DAYS; i < bars.length - MIN_CANDLES_FOR_INDICATORS; i++) {
        const date = new Date(bars[i].date);
        if (date.getDay() === 2) { // Tuesday
          tuesdayIndices.push(i);
        }
      }

      // Sample up to 8 Tuesdays per ticker for diversity
      const selectedTuesdays = tuesdayIndices.slice(0, 8);

      for (const idx of selectedTuesdays) {
        const row = buildSnapshotRow(stock.ticker, bars, idx, currentRegime);
        if (!row) continue;

        // Compute NCS at this historical point (READ ONLY from dual-score)
        const scored = scoreRow(row);
        const ncs = scored.NCS;

        // Compute forward return: price change over next FORWARD_DAYS trading days
        const futureIdx = idx - FORWARD_DAYS; // bars are newest-first
        if (futureIdx < 0) continue;
        const futurePrice = bars[futureIdx].close;
        const currentPrice = bars[idx].close;
        if (currentPrice <= 0) continue;

        const forwardReturn = ((futurePrice - currentPrice) / currentPrice) * 100;

        allNCSPredicted.push(ncs);
        allForwardReturns.push(forwardReturn);
        pairs.push({ predicted: ncs, forwardReturn });
      }
    } catch {
      // Skip tickers that fail to fetch — Yahoo Finance may be rate-limited
      continue;
    }
  }

  if (pairs.length < MIN_RESIDUALS) {
    return {
      residuals: [],
      sampleSize: pairs.length,
      tickersSampled: sampled.length,
      datesPerTicker: 0,
      regime: regime,
    };
  }

  // Convert forward returns to outcome-implied NCS values
  const impliedNCSValues = allForwardReturns.map(r =>
    forwardReturnToImpliedNCS(r, allForwardReturns)
  );

  // Compute residuals: NCS_predicted - NCS_outcome_implied
  const residuals = pairs.map((p, i) => p.predicted - impliedNCSValues[i]);

  return {
    residuals,
    sampleSize: pairs.length,
    tickersSampled: sampled.length,
    datesPerTicker: pairs.length / sampled.length,
    regime,
  };
}

// ── Full Calibration Pipeline ────────────────────────────────

export interface CalibrationResult {
  calibrated: boolean;
  coverageLevels: number[];
  sampleSize: number;
  regime: string | null;
  skippedReason?: string;
}

/**
 * Run full calibration: check eligibility, generate residuals, compute
 * quantiles, store to DB. Called by nightly pipeline and manual API.
 */
export async function runFullCalibration(
  regime: string | null = null,
  force = false
): Promise<CalibrationResult> {
  // Check if recalibration is needed
  if (!force) {
    // Estimate current sample size from CandidateOutcome count
    const outcomeCount = await prisma.candidateOutcome.count({
      where: { enrichedAt: { not: null } },
    });

    const eligible = await shouldRecalibrate(outcomeCount, regime);
    if (!eligible) {
      return {
        calibrated: false,
        coverageLevels: [],
        sampleSize: 0,
        regime,
        skippedReason: 'Recalibration not needed (sample size unchanged, calibration fresh)',
      };
    }
  }

  console.log(`[Conformal] Running bootstrap calibration (regime: ${regime ?? 'ALL'})...`);
  const bootstrap = await runBootstrapCalibration(regime);

  if (bootstrap.residuals.length < MIN_RESIDUALS) {
    return {
      calibrated: false,
      coverageLevels: [],
      sampleSize: bootstrap.sampleSize,
      regime,
      skippedReason: `Insufficient residuals: ${bootstrap.residuals.length} (need ${MIN_RESIDUALS})`,
    };
  }

  // Compute and store quantiles at each coverage level
  for (const coverage of COVERAGE_LEVELS) {
    const qHat = computeQHat(bootstrap.residuals.map(Math.abs), coverage);
    const { qHatUp, qHatDown } = computeAsymmetricQHats(bootstrap.residuals, coverage);

    await saveCalibration({
      coverageLevel: coverage,
      qHat,
      qHatUp,
      qHatDown,
      sampleSize: bootstrap.sampleSize,
      regime,
      source: 'bootstrap',
    });
  }

  console.log(`[Conformal] Calibration complete: ${bootstrap.sampleSize} samples, ${bootstrap.tickersSampled} tickers`);

  return {
    calibrated: true,
    coverageLevels: [...COVERAGE_LEVELS],
    sampleSize: bootstrap.sampleSize,
    regime,
  };
}
