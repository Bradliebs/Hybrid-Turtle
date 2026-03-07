/**
 * DEPENDENCIES
 * Consumed by: /api/signals/vpin/route.ts, nightly pre-cache
 * Consumes: order-flow-imbalance.ts, market-data.ts (getDailyPrices)
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: VPIN (Volume-Synchronized Probability of Informed Trading) approximation
 *        using daily OHLCV data (Yahoo Finance intraday is unreliable long-term).
 *        Produces two outputs:
 *          VPIN (0–1): magnitude of order flow imbalance
 *          DOFI (-1 to +1): directional order flow imbalance (positive = buying)
 *        DOFI > +0.3 → bullish signal boost; DOFI < -0.3 → suppress trade.
 *        ⛔ Does NOT modify sacred files. Applied as post-processing layer.
 */

import { classifyAllBars, type OHLCVBar, type ClassifiedVolume } from './order-flow-imbalance';

// ── Types ────────────────────────────────────────────────────

export interface VPINResult {
  ticker: string;
  /** VPIN: magnitude of imbalance (0 = balanced, 1 = fully one-sided) */
  vpin: number;
  /** Directional OFI: positive = buying pressure, negative = selling */
  dofi: number;
  /** Signal interpretation */
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  /** NCS adjustment from DOFI */
  ncsAdjustment: number;
  /** Number of bars used in computation */
  barsUsed: number;
  computedAt: Date;
}

// ── Constants ────────────────────────────────────────────────

/** Rolling window for VPIN calculation (in bars) */
const VPIN_WINDOW = 20;

/** DOFI thresholds for signal classification */
const DOFI_STRONG_BUY = 0.30;
const DOFI_BUY = 0.15;
const DOFI_SELL = -0.15;
const DOFI_STRONG_SELL = -0.30;

/** NCS adjustment range */
const MAX_NCS_BOOST = 8;
const MAX_NCS_PENALTY = -12;

// ── VPIN Computation ─────────────────────────────────────────

/**
 * Compute VPIN and DOFI from classified volume data.
 */
function computeVPINFromClassified(classified: ClassifiedVolume[]): { vpin: number; dofi: number } {
  if (classified.length === 0) return { vpin: 0, dofi: 0 };

  // Use last VPIN_WINDOW bars
  const window = classified.slice(0, VPIN_WINDOW);
  if (window.length < 5) return { vpin: 0, dofi: 0 };

  // VPIN = mean of absolute imbalance over window
  let totalAbsImbalance = 0;
  let totalBuy = 0;
  let totalSell = 0;
  let totalVol = 0;

  for (const bar of window) {
    totalAbsImbalance += Math.abs(bar.imbalance);
    totalBuy += bar.buyVolume;
    totalSell += bar.sellVolume;
    totalVol += bar.totalVolume;
  }

  const vpin = totalAbsImbalance / window.length;

  // DOFI = net directional imbalance
  const dofi = totalVol > 0 ? (totalBuy - totalSell) / totalVol : 0;

  return {
    vpin: Math.round(Math.max(0, Math.min(1, vpin)) * 1000) / 1000,
    dofi: Math.round(Math.max(-1, Math.min(1, dofi)) * 1000) / 1000,
  };
}

/**
 * Classify DOFI into a trading signal.
 */
function classifySignal(dofi: number): VPINResult['signal'] {
  if (dofi >= DOFI_STRONG_BUY) return 'STRONG_BUY';
  if (dofi >= DOFI_BUY) return 'BUY';
  if (dofi <= DOFI_STRONG_SELL) return 'STRONG_SELL';
  if (dofi <= DOFI_SELL) return 'SELL';
  return 'NEUTRAL';
}

/**
 * Compute NCS adjustment from DOFI.
 * Positive DOFI → buying pressure → boost NCS.
 * Negative DOFI → selling pressure → penalise NCS.
 */
function computeNCSAdjustment(dofi: number): number {
  if (dofi >= DOFI_STRONG_BUY) {
    return Math.min(MAX_NCS_BOOST, Math.round(dofi * 20));
  }
  if (dofi >= DOFI_BUY) {
    return Math.round(dofi * 15);
  }
  if (dofi <= DOFI_STRONG_SELL) {
    return Math.max(MAX_NCS_PENALTY, Math.round(dofi * 25));
  }
  if (dofi <= DOFI_SELL) {
    return Math.round(dofi * 15);
  }
  return 0;
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Compute VPIN and DOFI from daily OHLCV bars.
 * Bars should be sorted newest-first (as returned by getDailyPrices).
 *
 * @param ticker - Ticker symbol
 * @param bars - Daily OHLCV bars (newest first)
 */
export function computeVPIN(
  ticker: string,
  bars: OHLCVBar[]
): VPINResult {
  if (!bars || bars.length < 5) {
    return {
      ticker,
      vpin: 0,
      dofi: 0,
      signal: 'NEUTRAL',
      ncsAdjustment: 0,
      barsUsed: 0,
      computedAt: new Date(),
    };
  }

  // Classify all bars into buy/sell volume
  const classified = classifyAllBars(bars);

  // Compute VPIN and DOFI
  const { vpin, dofi } = computeVPINFromClassified(classified);

  // Signal classification and NCS adjustment
  const signal = classifySignal(dofi);
  const ncsAdjustment = computeNCSAdjustment(dofi);

  return {
    ticker,
    vpin,
    dofi,
    signal,
    ncsAdjustment,
    barsUsed: Math.min(bars.length, VPIN_WINDOW),
    computedAt: new Date(),
  };
}
