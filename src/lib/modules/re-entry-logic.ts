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
import { getDailyPrices, calculate20DayHigh } from '../market-data';

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
  const signals: ReEntrySignal[] = [];

  const eligible = closedPositions.filter(p => {
    if (!p.exitProfitR || p.exitProfitR < MIN_EXIT_R) return false;
    // Not stop-hit exits (those go through fast-follower)
    if (p.exitReason === 'STOP_HIT') return false;
    return true;
  });

  for (const pos of eligible) {
    try {
      const exitDate = pos.exitDate instanceof Date ? pos.exitDate : new Date(pos.exitDate);
      const daysSinceExit = Math.floor(
        (now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const cooldownComplete = daysSinceExit >= COOLDOWN_DAYS;

      if (daysSinceExit > 30) continue; // Too old

      const bars = await getDailyPrices(pos.ticker, 'compact');
      if (bars.length < 20) continue;

      const price = bars[0].close;
      const twentyDayHigh = calculate20DayHigh(bars);
      const reclaimedTwentyDayHigh = price >= twentyDayHigh;

      const isEligible = cooldownComplete && reclaimedTwentyDayHigh;

      signals.push({
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
      });
    } catch {
      // Skip failed tickers
    }
  }

  return signals;
}
