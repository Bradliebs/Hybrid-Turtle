// Shared client/server scan guard utilities.
// Gap anti-chase guard (Mode A):
// - Purpose: avoid impulsive entries after a gap above trigger on any trading day.
// - Configurable via GapGuardConfig: 'ALL' (default) runs every day,
//   'MONDAY_ONLY' preserves legacy Monday-only behaviour.
// - Monday uses weekend thresholds (3-day gap); Tue–Fri uses daily thresholds.
// - Blocks when either threshold is exceeded:
//   1) gapATR > threshold  where gapATR = (currentPrice - entryTrigger) / ATR
//   2) percentAbove > threshold where percentAbove = ((currentPrice / entryTrigger) - 1) * 100
// - Weekends (Sat/Sun) and non-trading contexts automatically pass.

import type { GapGuardConfig } from '@/types';
import { DEFAULT_GAP_GUARD_CONFIG } from '@/types';

export function checkAntiChasingGuard(
  currentPrice: number,
  entryTrigger: number,
  atr: number,
  dayOfWeek: number,
  config: GapGuardConfig = DEFAULT_GAP_GUARD_CONFIG
): { passed: boolean; reason: string } {
  // Weekends (0=Sun, 6=Sat) always pass — markets closed
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { passed: true, reason: 'Weekend — gap guard inactive' };
  }

  // MONDAY_ONLY mode: skip guard on Tue–Fri
  if (config.enabledDays === 'MONDAY_ONLY' && dayOfWeek !== 1) {
    return { passed: true, reason: 'Not Monday — execution guard inactive (Monday-only mode)' };
  }

  // Only evaluate candidates where price is at or above entry trigger
  if (currentPrice < entryTrigger) {
    return { passed: true, reason: 'Below entry trigger — no chase risk' };
  }

  // Pick thresholds based on day: Monday uses weekend thresholds (3-day gap),
  // Tue–Fri uses daily thresholds (1-day gap, higher bar to avoid over-triggering)
  const isWeekendGap = dayOfWeek === 1; // Monday = post-weekend
  const atrLimit = isWeekendGap ? config.weekendThresholdATR : config.dailyThresholdATR;
  const pctLimit = isWeekendGap ? config.weekendThresholdPct : config.dailyThresholdPct;
  const dayLabel = isWeekendGap ? 'Monday' : ['', '', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][dayOfWeek];

  const gap = currentPrice - entryTrigger;
  const gapATR = atr > 0 ? gap / atr : 0;
  const percentAbove = ((currentPrice / entryTrigger) - 1) * 100;

  // Check gap > ATR threshold
  if (gapATR > atrLimit) {
    return {
      passed: false,
      reason: `⚠ Recent gap (${dayLabel}): stock moved ${gapATR.toFixed(2)} ATR above trigger (limit ${atrLimit}) — potential chase entry`,
    };
  }

  // Check > percent threshold
  if (percentAbove > pctLimit) {
    return {
      passed: false,
      reason: `⚠ Recent gap (${dayLabel}): stock moved ${percentAbove.toFixed(1)}% above trigger (limit ${pctLimit}%) — potential chase entry`,
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
