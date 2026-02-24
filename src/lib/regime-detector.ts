/**
 * DEPENDENCIES
 * Consumed by: /api/modules/route.ts, market-data.ts (via getMarketRegime)
 * Consumes: @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-24
 * Notes: Requires 3 consecutive days same regime for BULLISH confirmation. Do not reduce.
 *        detectVolRegime() is separate from directional regime — SPY ATR% based.
 */
// ============================================================
// Market Regime Detector — with CHOP, ±2% Band, Dual Benchmark
// ============================================================
// Modules: #9 Regime Stability, #10 ±2% CHOP Band, #19 Dual Benchmark

import type { MarketRegime, VolRegime, DualRegimeResult, RegimeStabilityResult } from '@/types';

const CHOP_BAND_PCT = 0.02; // ±2% band around 200MA for CHOP zone

// ── Volatility Regime Thresholds (SPY 14-day ATR%) ──
const VOL_LOW_THRESHOLD = 1.0;   // ATR% < 1% → LOW_VOL
const VOL_HIGH_THRESHOLD = 2.0;  // ATR% > 2% → HIGH_VOL

export interface DetectVolRegimeResult {
  volRegime: VolRegime;
  spyAtrPercent: number;
  reason: string;
}

/**
 * Detect volatility regime from SPY 14-day ATR%.
 * Separate from directional regime — does not affect BULLISH/BEARISH/SIDEWAYS.
 * Pure function: caller supplies pre-computed ATR%.
 */
export function detectVolRegime(spyAtrPercent: number): DetectVolRegimeResult {
  let volRegime: VolRegime;
  let reason: string;

  if (spyAtrPercent < VOL_LOW_THRESHOLD) {
    volRegime = 'LOW_VOL';
    reason = `SPY ATR% ${spyAtrPercent.toFixed(2)}% < ${VOL_LOW_THRESHOLD}% — low volatility`;
  } else if (spyAtrPercent > VOL_HIGH_THRESHOLD) {
    volRegime = 'HIGH_VOL';
    reason = `SPY ATR% ${spyAtrPercent.toFixed(2)}% > ${VOL_HIGH_THRESHOLD}% — high volatility`;
  } else {
    volRegime = 'NORMAL_VOL';
    reason = `SPY ATR% ${spyAtrPercent.toFixed(2)}% within ${VOL_LOW_THRESHOLD}–${VOL_HIGH_THRESHOLD}% — normal volatility`;
  }

  return { volRegime, spyAtrPercent, reason };
}

// ── Multi-Signal Regime Detection (SPY-only, pure function) ──
// Uses a bull/bear scoring model across 5 signals:
//   SPY vs MA200, ADX trend strength, DI direction, VIX fear, A/D breadth.
// ±2% CHOP band override: forces SIDEWAYS when price is near MA200.

interface DetectRegimeInput {
  spyPrice: number;
  spy200MA: number;
  spyAdx: number;
  spyPlusDI: number;
  spyMinusDI: number;
  vixLevel: number;
  advanceDeclineRatio: number;
}

interface DetectRegimeResult {
  regime: MarketRegime;
  confidence: number;
  inChopBand: boolean;
  reasons: string[];
}

/**
 * Detect market regime from SPY market data using a multi-signal scoring model.
 * Returns regime, confidence (0–1), CHOP band status, and reason strings.
 */
export function detectRegime(input: DetectRegimeInput): DetectRegimeResult {
  const { spyPrice, spy200MA, spyAdx, spyPlusDI, spyMinusDI, vixLevel, advanceDeclineRatio } = input;
  const reasons: string[] = [];

  // ±2% CHOP band — overrides everything when price is near MA200
  const band = spy200MA * CHOP_BAND_PCT;
  const inChopBand = Math.abs(spyPrice - spy200MA) <= band;

  if (inChopBand) {
    reasons.push(`CHOP BAND: price ${spyPrice.toFixed(0)} within ±2% of MA200 ${spy200MA.toFixed(0)} — forced SIDEWAYS`);
    return { regime: 'SIDEWAYS', confidence: 0.5, inChopBand, reasons };
  }

  // Score bull vs bear signals (each signal awards 1–3 points)
  let bull = 0;
  let bear = 0;

  // Signal 1: Price vs MA200 (strong signal, +3)
  if (spyPrice > spy200MA) {
    bull += 3;
    reasons.push(`SPY ${spyPrice.toFixed(0)} above MA200 ${spy200MA.toFixed(0)} (+3 bull)`);
  } else {
    bear += 3;
    reasons.push(`SPY ${spyPrice.toFixed(0)} below MA200 ${spy200MA.toFixed(0)} (+3 bear)`);
  }

  // Signal 2: ADX trend strength (+1 if trending)
  if (spyAdx >= 25) {
    // Strong trend — amplify the directional signal
    if (spyPlusDI > spyMinusDI) { bull += 1; reasons.push(`ADX ${spyAdx.toFixed(0)} strong trend, +DI leads (+1 bull)`); }
    else { bear += 1; reasons.push(`ADX ${spyAdx.toFixed(0)} strong trend, −DI leads (+1 bear)`); }
  }

  // Signal 3: DI direction (+2)
  if (spyPlusDI > spyMinusDI) {
    bull += 2;
    reasons.push(`+DI ${spyPlusDI.toFixed(0)} > −DI ${spyMinusDI.toFixed(0)} (+2 bull)`);
  } else {
    bear += 2;
    reasons.push(`−DI ${spyMinusDI.toFixed(0)} > +DI ${spyPlusDI.toFixed(0)} (+2 bear)`);
  }

  // Signal 4: VIX fear level (+1)
  if (vixLevel < 20) {
    bull += 1;
    reasons.push(`VIX ${vixLevel.toFixed(0)} low — calm market (+1 bull)`);
  } else if (vixLevel >= 30) {
    bear += 1;
    reasons.push(`VIX ${vixLevel.toFixed(0)} elevated — fear (+1 bear)`);
  } else {
    reasons.push(`VIX ${vixLevel.toFixed(0)} neutral`);
  }

  // Signal 5: Advance/Decline ratio (+1)
  if (advanceDeclineRatio > 1.2) {
    bull += 1;
    reasons.push(`A/D ratio ${advanceDeclineRatio.toFixed(1)} — broad strength (+1 bull)`);
  } else if (advanceDeclineRatio < 0.8) {
    bear += 1;
    reasons.push(`A/D ratio ${advanceDeclineRatio.toFixed(1)} — broad weakness (+1 bear)`);
  }

  // Classify: need 5+ for directional conviction, otherwise SIDEWAYS
  const total = bull + bear;
  let regime: MarketRegime;
  if (bull >= 5) {
    regime = 'BULLISH';
  } else if (bear >= 5) {
    regime = 'BEARISH';
  } else {
    regime = 'SIDEWAYS';
  }

  const confidence = total > 0 ? Math.max(bull, bear) / total : 0.5;

  return { regime, confidence, inChopBand, reasons };
}

/**
 * Module 9: Regime Stability — requires 3 consecutive days before labeling
 * Prevents regime flicker
 */
export function checkRegimeStability(
  currentRegime: MarketRegime,
  regimeHistory: { regime: string; date: Date }[]
): RegimeStabilityResult {
  // Sort most recent first
  const sorted = [...regimeHistory].sort((a, b) => b.date.getTime() - a.date.getTime());

  // Verify most recent history record matches current regime before counting
  let consecutiveDays = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].regime === currentRegime) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  const isStable = consecutiveDays >= 3;

  return {
    currentRegime: isStable ? currentRegime : 'CHOP',
    consecutiveDays,
    isStable,
    band: { upper: 0, lower: 0, inBand: false }, // filled by caller
    reason: isStable
      ? `${currentRegime} for ${consecutiveDays} consecutive days — confirmed`
      : `${currentRegime} only ${consecutiveDays} day(s) — needs 3 for confirmation (showing as CHOP)`,
  };
}

/**
 * Module 19: Dual Benchmark Regime — SPY + VWRL
 */
export function detectDualRegime(
  spyPrice: number,
  spyMa200: number,
  vwrlPrice: number,
  vwrlMa200: number
): DualRegimeResult {
  const spyBand = spyMa200 * CHOP_BAND_PCT;
  const vwrlBand = vwrlMa200 * CHOP_BAND_PCT;

  const spyInChop = Math.abs(spyPrice - spyMa200) <= spyBand;
  const vwrlInChop = Math.abs(vwrlPrice - vwrlMa200) <= vwrlBand;

  const spyRegime: MarketRegime = spyInChop ? 'SIDEWAYS' : spyPrice > spyMa200 ? 'BULLISH' : 'BEARISH';
  const vwrlRegime: MarketRegime = vwrlInChop ? 'SIDEWAYS' : vwrlPrice > vwrlMa200 ? 'BULLISH' : 'BEARISH';

  // Combined: both must be BULLISH for full BULLISH, either BEARISH = BEARISH
  let combined: MarketRegime;
  if (spyRegime === 'BULLISH' && vwrlRegime === 'BULLISH') {
    combined = 'BULLISH';
  } else if (spyRegime === 'BEARISH' || vwrlRegime === 'BEARISH') {
    combined = 'BEARISH';
  } else {
    combined = 'SIDEWAYS';
  }

  return {
    spy: { regime: spyRegime, price: spyPrice, ma200: spyMa200 },
    vwrl: { regime: vwrlRegime, price: vwrlPrice, ma200: vwrlMa200 },
    combined,
    chopDetected: spyInChop || vwrlInChop,
    consecutiveDays: 1, // caller should set from history
  };
}

/**
 * Simple regime check — can we buy?
 */
export function canBuy(regime: MarketRegime): boolean {
  return regime === 'BULLISH';
}
