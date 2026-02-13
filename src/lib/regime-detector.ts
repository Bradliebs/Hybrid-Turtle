// ============================================================
// Market Regime Detector — with CHOP, ±2% Band, Dual Benchmark
// ============================================================
// Modules: #9 Regime Stability, #10 ±2% CHOP Band, #19 Dual Benchmark

import type { MarketRegime, DualRegimeResult, RegimeStabilityResult } from '@/types';

interface RegimeInput {
  spyPrice: number;
  spy200MA: number;
  spyAdx: number;
  spyPlusDI: number;
  spyMinusDI: number;
  vixLevel: number;
  advanceDeclineRatio: number;
}

const CHOP_BAND_PCT = 0.02; // ±2% band around 200MA for CHOP zone

/**
 * Detect market regime based on S&P 500 technical conditions
 * Now includes ±2% CHOP band (Module 10)
 */
export function detectRegime(input: RegimeInput): {
  regime: MarketRegime;
  confidence: number;
  reasons: string[];
  inChopBand: boolean;
} {
  const reasons: string[] = [];
  let bullishPoints = 0;
  let bearishPoints = 0;

  // Module 10: ±2% CHOP band
  const upperBand = input.spy200MA * (1 + CHOP_BAND_PCT);
  const lowerBand = input.spy200MA * (1 - CHOP_BAND_PCT);
  const inChopBand = input.spyPrice >= lowerBand && input.spyPrice <= upperBand;

  if (inChopBand) {
    reasons.push(`SPY ($${input.spyPrice.toFixed(2)}) inside ±2% CHOP band ($${lowerBand.toFixed(2)}–$${upperBand.toFixed(2)})`);
  }

  // Price vs 200 MA
  if (input.spyPrice > input.spy200MA) {
    bullishPoints += 3;
    reasons.push(`SPY ($${input.spyPrice.toFixed(2)}) above 200-MA ($${input.spy200MA.toFixed(2)})`);
  } else {
    bearishPoints += 3;
    reasons.push(`SPY ($${input.spyPrice.toFixed(2)}) below 200-MA ($${input.spy200MA.toFixed(2)})`);
  }

  // Directional movement
  if (input.spyPlusDI > input.spyMinusDI) {
    bullishPoints += 2;
    reasons.push(`+DI (${input.spyPlusDI.toFixed(1)}) > -DI (${input.spyMinusDI.toFixed(1)})`);
  } else {
    bearishPoints += 2;
    reasons.push(`-DI (${input.spyMinusDI.toFixed(1)}) > +DI (${input.spyPlusDI.toFixed(1)})`);
  }

  // VIX level
  if (input.vixLevel < 20) {
    bullishPoints += 1;
    reasons.push(`VIX (${input.vixLevel.toFixed(1)}) is low — calm market`);
  } else if (input.vixLevel > 30) {
    bearishPoints += 1;
    reasons.push(`VIX (${input.vixLevel.toFixed(1)}) is elevated — fear present`);
  }

  // Trend strength
  if (input.spyAdx >= 25) {
    reasons.push(`ADX (${input.spyAdx.toFixed(1)}) shows strong trend`);
  }

  // Advance/Decline
  if (input.advanceDeclineRatio > 1.2) {
    bullishPoints += 1;
    reasons.push(`A/D ratio (${input.advanceDeclineRatio.toFixed(2)}) favors advances`);
  } else if (input.advanceDeclineRatio < 0.8) {
    bearishPoints += 1;
    reasons.push(`A/D ratio (${input.advanceDeclineRatio.toFixed(2)}) favors declines`);
  }

  // Determine regime — CHOP band forces SIDEWAYS
  const totalPoints = bullishPoints + bearishPoints;
  let regime: MarketRegime;
  let confidence: number;

  if (inChopBand) {
    regime = 'SIDEWAYS';
    confidence = 0.5;
    reasons.push('CHOP BAND active — regime forced to SIDEWAYS');
  } else if (bullishPoints >= 5) {
    regime = 'BULLISH';
    confidence = bullishPoints / totalPoints;
  } else if (bearishPoints >= 5) {
    regime = 'BEARISH';
    confidence = bearishPoints / totalPoints;
  } else {
    regime = 'SIDEWAYS';
    confidence = 0.5;
  }

  return { regime, confidence, reasons, inChopBand };
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

  let consecutiveDays = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].regime === currentRegime) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  const isStable = consecutiveDays >= 3;
  const displayRegime = isStable ? currentRegime : 'SIDEWAYS';

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
