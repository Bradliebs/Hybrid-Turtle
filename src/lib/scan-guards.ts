// Shared client/server scan guard utilities.
// Monday-only gap anti-chase guard (Mode A):
// - Purpose: avoid impulsive Monday entries after an opening gap above trigger.
// - Active only when dayOfWeek === 1 (Monday) AND currentPrice >= entryTrigger.
// - Blocks when either threshold is exceeded:
//   1) gapATR > 0.75 where gapATR = (currentPrice - entryTrigger) / ATR
//   2) percentAbove > 3.0 where percentAbove = ((currentPrice / entryTrigger) - 1) * 100
// - Outside those conditions, this guard is intentionally inactive.

export function checkAntiChasingGuard(
  currentPrice: number,
  entryTrigger: number,
  atr: number,
  dayOfWeek: number
): { passed: boolean; reason: string } {
  if (dayOfWeek !== 1) {
    return { passed: true, reason: 'Not Monday — execution guard inactive' };
  }

  // Only evaluate candidates where price is at or above entry trigger
  if (currentPrice < entryTrigger) {
    return { passed: true, reason: 'Below entry trigger — no chase risk' };
  }

  const gap = currentPrice - entryTrigger;
  const gapATR = atr > 0 ? gap / atr : 0;
  const percentAbove = ((currentPrice / entryTrigger) - 1) * 100;

  // Check gap > 0.75 ATR
  if (gapATR > 0.75) {
    return {
      passed: false,
      reason: `CHASE RISK — gapped ${gapATR.toFixed(2)} ATR above trigger (limit 0.75)`,
    };
  }

  // Check > 3% above trigger
  if (percentAbove > 3.0) {
    return {
      passed: false,
      reason: `CHASE RISK — ${percentAbove.toFixed(1)}% above trigger (limit 3.0%)`,
    };
  }

  return {
    passed: true,
    reason: `OK — ${gapATR.toFixed(2)} ATR gap, ${percentAbove.toFixed(1)}% above trigger`,
  };
}

export interface PullbackContinuationInput {
  status: string;
  hh20: number;
  ema20: number;
  atr: number;
  close: number;
  low: number;
  pullbackLow?: number;
}

export interface PullbackContinuationSignal {
  triggered: boolean;
  mode: 'BREAKOUT' | 'PULLBACK_CONTINUATION';
  anchor: number;
  zoneLow: number;
  zoneHigh: number;
  entryPrice?: number;
  stopPrice?: number;
  reason: string;
}

/**
 * Mode B: Pullback Continuation Entry
 * - Only valid for WAIT_PULLBACK candidates
 * - anchor = max(HH20, EMA20)
 * - pullback zone = anchor ± 0.25 * ATR
 * - trigger when price dips into zone and closes back above zoneHigh
 * - stop = pullbackLow - 0.5 * ATR
 */
export function checkPullbackContinuationEntry(
  input: PullbackContinuationInput
): PullbackContinuationSignal {
  const { status, hh20, ema20, atr, close, low, pullbackLow } = input;

  const anchor = Math.max(hh20, ema20);
  const zoneHalfWidth = 0.25 * atr;
  const zoneLow = anchor - zoneHalfWidth;
  const zoneHigh = anchor + zoneHalfWidth;

  if (status !== 'WAIT_PULLBACK') {
    return {
      triggered: false,
      mode: 'PULLBACK_CONTINUATION',
      anchor,
      zoneLow,
      zoneHigh,
      reason: 'Not WAIT_PULLBACK — Mode B inactive',
    };
  }

  if (atr <= 0) {
    return {
      triggered: false,
      mode: 'PULLBACK_CONTINUATION',
      anchor,
      zoneLow,
      zoneHigh,
      reason: 'Invalid ATR — cannot evaluate pullback continuation',
    };
  }

  const dippedIntoZone = low <= zoneHigh && low >= zoneLow;
  const closedBackAboveZoneHigh = close > zoneHigh;

  if (!dippedIntoZone || !closedBackAboveZoneHigh) {
    return {
      triggered: false,
      mode: 'PULLBACK_CONTINUATION',
      anchor,
      zoneLow,
      zoneHigh,
      reason: `No trigger — dippedIntoZone=${dippedIntoZone}, close=${close.toFixed(2)}, zoneHigh=${zoneHigh.toFixed(2)}`,
    };
  }

  const effectivePullbackLow = pullbackLow ?? low;
  const stopPrice = effectivePullbackLow - 0.5 * atr;

  return {
    triggered: true,
    mode: 'PULLBACK_CONTINUATION',
    anchor,
    zoneLow,
    zoneHigh,
    entryPrice: close,
    stopPrice,
    reason: `Triggered — dip in zone and close above zoneHigh (${zoneHigh.toFixed(2)})`,
  };
}
