// ============================================================
// Module 11: Whipsaw Kill Switch
// ============================================================
// Blocks re-entry on tickers that stopped out 2× within 30 days.
// Prevents "death by a thousand cuts."
// ============================================================

import 'server-only';
import type { WhipsawBlock } from '@/types';
import { getWeekStart } from '@/lib/utils';

interface ClosedPositionForWhipsaw {
  ticker: string;
  exitDate: Date | string;
  exitReason: string | null;
  whipsawCount?: number;
}

const WHIPSAW_LOOKBACK_DAYS = 30;
const WHIPSAW_PENALTY_DAYS = 60;
const WHIPSAW_STOP_THRESHOLD = 2;

/**
 * Check which tickers are blocked due to repeated stop-outs.
 */
export function checkWhipsawBlocks(
  closedPositions: ClosedPositionForWhipsaw[]
): WhipsawBlock[] {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const blocks: WhipsawBlock[] = [];

  // Group stop-hits by ticker within last 30 days
  const stopHitsByTicker = new Map<string, number>();
  const lastStopByTicker = new Map<string, Date>();

  for (const pos of closedPositions) {
    if (pos.exitReason !== 'STOP_HIT') continue;

    const exitDate = pos.exitDate instanceof Date ? pos.exitDate : new Date(pos.exitDate);
    if (exitDate >= weekStart) {
      continue;
    }
    const daysSince = Math.floor((now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince <= WHIPSAW_LOOKBACK_DAYS) {
      const count = (stopHitsByTicker.get(pos.ticker) || 0) + 1;
      stopHitsByTicker.set(pos.ticker, count);
      const lastStop = lastStopByTicker.get(pos.ticker);
      if (!lastStop || exitDate > lastStop) {
        lastStopByTicker.set(pos.ticker, exitDate);
      }
    }
  }

  for (const [ticker, count] of Array.from(stopHitsByTicker)) {
    const lastStop = lastStopByTicker.get(ticker);
    const daysSinceLastStop = lastStop
      ? Math.floor((now.getTime() - lastStop.getTime()) / (1000 * 60 * 60 * 24))
      : Number.POSITIVE_INFINITY;
    const blocked = count >= WHIPSAW_STOP_THRESHOLD && daysSinceLastStop <= WHIPSAW_PENALTY_DAYS;
    if (blocked) {
      blocks.push({
        ticker,
        stopsInLast30Days: count,
        blocked: true,
        reason: `WHIPSAW BLOCK: ${ticker} stopped out ${count}× in last 30 days — re-entry blocked for ${WHIPSAW_PENALTY_DAYS} days`,
      });
    }
  }

  return blocks;
}
