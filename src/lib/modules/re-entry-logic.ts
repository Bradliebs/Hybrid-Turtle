// ============================================================
// Module 20: Re-Entry Logic (with Cooldown)
// ============================================================
// Full re-entry system:
//   - Profitable exit > 0.5R
//   - 5-day cooldown after exit
//   - Require new 20-day high reclaim
// ============================================================

import 'server-only';
import type { ReEntrySignal } from '@/types';
import { getDailyPrices, getPriorNDayHigh } from '../market-data';

const COOLDOWN_DAYS = 5;
const MIN_EXIT_R = 0.5; // Must have exited at > 0.5R profit

interface ClosedPositionForReEntry {
  ticker: string;
  exitDate: Date | string;
  exitProfitR: number | null;
  exitReason: string | null;
}

/**
 * Scan for re-entry opportunities on profitable exits after cooldown.
 */
export async function scanReEntrySignals(
  closedPositions: ClosedPositionForReEntry[]
): Promise<ReEntrySignal[]> {
  const now = new Date();

  const eligible = closedPositions.filter(p => {
    if (!p.exitProfitR || p.exitProfitR < MIN_EXIT_R) return false;
    // Not stop-hit exits (those go through fast-follower)
    if (p.exitReason === 'STOP_HIT') return false;
    const exitDate = p.exitDate instanceof Date ? p.exitDate : new Date(p.exitDate);
    const daysSinceExit = Math.floor(
      (now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceExit <= 30; // Skip >30 day old exits early
  });

  if (eligible.length === 0) return [];

  const results = await Promise.allSettled(
    eligible.map(async (pos): Promise<ReEntrySignal | null> => {
      const exitDate = pos.exitDate instanceof Date ? pos.exitDate : new Date(pos.exitDate);
      const daysSinceExit = Math.floor(
        (now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const cooldownComplete = daysSinceExit >= COOLDOWN_DAYS;

      const bars = await getDailyPrices(pos.ticker, 'compact');
      if (bars.length < 20) return null;

      const price = bars[0].close;
      // Exclude today's bar so "reclaimed 20-day high" isn't trivially true on breakout days
      const twentyDayHigh = getPriorNDayHigh(bars, 20);
      const reclaimedTwentyDayHigh = price >= twentyDayHigh;

      const isEligible = cooldownComplete && reclaimedTwentyDayHigh;

      return {
        ticker: pos.ticker,
        exitDate: exitDate.toISOString().split('T')[0],
        exitProfitR: pos.exitProfitR || 0,
        daysSinceExit,
        cooldownComplete,
        reclaimedTwentyDayHigh,
        eligible: isEligible,
        reason: isEligible
          ? `RE-ENTRY: ${pos.ticker} exited at +${pos.exitProfitR?.toFixed(1)}R, cooldown ${daysSinceExit}d, reclaimed 20d high`
          : `${!cooldownComplete ? `Cooldown: ${COOLDOWN_DAYS - daysSinceExit}d remaining` : ''} ${!reclaimedTwentyDayHigh ? 'Below 20d high' : ''}`.trim(),
      };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ReEntrySignal | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((v): v is ReEntrySignal => v !== null);
}
