// Shared client/server scan guard utilities.
// Execution Guard: (Price - Entry) / ATR ≤ 0.75  AND  Price / Entry - 1 ≤ 3.0%
// Prevents chasing gaps — applies to all triggered candidates.

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
