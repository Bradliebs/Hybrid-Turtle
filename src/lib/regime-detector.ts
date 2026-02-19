// ============================================================
// Market Regime Detector — with CHOP, ±2% Band, Dual Benchmark
// ============================================================
// Modules: #9 Regime Stability, #10 ±2% CHOP Band, #19 Dual Benchmark

import type { MarketRegime, DualRegimeResult, RegimeStabilityResult } from '@/types';

const CHOP_BAND_PCT = 0.02; // ±2% band around 200MA for CHOP zone

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
