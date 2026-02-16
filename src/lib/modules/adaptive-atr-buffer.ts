// ============================================================
// Module 11b: Adaptive ATR Entry Buffer
// ============================================================
// Scales entry buffer 5%–20% based on ATR%
// (volatile stocks get tighter buffer).
// Dashboard previously used fixed 10%.
// ============================================================

import type { AdaptiveBufferResult } from '@/types';

/**
 * Calculate adaptive entry buffer based on ATR%.
 * Low ATR% (< 2%) → looser buffer (20% of ATR as trigger offset)
 * High ATR% (> 6%) → tighter buffer (5% of ATR as trigger offset)
 * Linear interpolation between.
 */
export function calculateAdaptiveBuffer(
  ticker: string,
  twentyDayHigh: number,
  atr: number,
  atrPercent: number,
  priorTwentyDayHigh?: number
): AdaptiveBufferResult {
  // Scale: ATR% 2 → 20% buffer, ATR% 6 → 5% buffer
  // Clamp to [5%, 20%]
  const minBuffer = 0.05;
  const maxBuffer = 0.20;
  const minATR = 2;
  const maxATR = 6;

  let bufferPercent: number;
  if (atrPercent <= minATR) {
    bufferPercent = maxBuffer;
  } else if (atrPercent >= maxATR) {
    bufferPercent = minBuffer;
  } else {
    // Linear interpolation (inverse relationship)
    bufferPercent = maxBuffer - ((atrPercent - minATR) / (maxATR - minATR)) * (maxBuffer - minBuffer);
  }

  const usePrior20DayHighForTrigger = process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER === 'true';
  const triggerBaseHigh = usePrior20DayHighForTrigger && typeof priorTwentyDayHigh === 'number'
    ? priorTwentyDayHigh
    : twentyDayHigh;
  const adjustedEntryTrigger = triggerBaseHigh + bufferPercent * atr;

  return {
    ticker,
    atrPercent,
    bufferPercent: bufferPercent * 100,
    adjustedEntryTrigger,
  };
}
