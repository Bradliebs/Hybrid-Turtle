// ============================================================
// Module 9: Fast-Follower Re-Entry
// ============================================================
// After stop-hit exit within 10 days, allows quick re-entry if
// stock reclaims 20d high + volume > 2×. Catches shakeout
// recoveries.
// ============================================================

import 'server-only';
import type { FastFollowerSignal } from '@/types';
import { getDailyPrices, getPriorNDayHigh } from '../market-data';

const MAX_DAYS_SINCE_EXIT = 10;
const VOLUME_THRESHOLD = 2.0;

interface ClosedPositionForFF {
  ticker: string;
  exitDate: Date | string;
  exitReason: string | null;
}

/**
 * Check recently stopped-out positions for fast-follower re-entry.
 * Criteria:
 *   1. Exited via stop-hit within last 10 days
 *   2. Price has reclaimed 20-day high
 *   3. Volume > 2× average
 *   4. Not blocked by whipsaw guard (Module 11)
 *
 * @param blockedTickers — tickers currently blocked by whipsaw guard
 */
export async function scanFastFollowers(
  closedPositions: ClosedPositionForFF[],
  blockedTickers?: Set<string>
): Promise<FastFollowerSignal[]> {
  const now = new Date();

  const recentStopOuts = closedPositions.filter(p => {
    if (p.exitReason !== 'STOP_HIT') return false;
    // Whipsaw guard takes precedence — blocked tickers cannot re-enter
    if (blockedTickers?.has(p.ticker)) return false;
    const exitDate = p.exitDate instanceof Date ? p.exitDate : new Date(p.exitDate);
    const daysSince = Math.floor((now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSince <= MAX_DAYS_SINCE_EXIT;
  });

  if (recentStopOuts.length === 0) return [];

  const results = await Promise.allSettled(
    recentStopOuts.map(async (pos): Promise<FastFollowerSignal | null> => {
      const bars = await getDailyPrices(pos.ticker, 'compact');
      if (bars.length < 20) return null;

      const price = bars[0].close;
      // Exclude today's bar so "reclaimed 20-day high" isn't trivially true on breakout days
      const twentyDayHigh = getPriorNDayHigh(bars, 20);
      const volume = bars[0].volume;
      const avgVolume20 = bars.slice(0, 20).reduce((s, b) => s + b.volume, 0) / 20;

      const exitDate = pos.exitDate instanceof Date ? pos.exitDate : new Date(pos.exitDate);
      const daysSinceExit = Math.floor((now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24));
      const reclaimedTwentyDayHigh = price >= twentyDayHigh;
      const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 0;
      const volumeOk = volumeRatio >= VOLUME_THRESHOLD;

      const eligible = reclaimedTwentyDayHigh && volumeOk;
      if (!eligible) return null;

      return {
        ticker: pos.ticker,
        exitDate: exitDate.toISOString().split('T')[0],
        daysSinceExit,
        reclaimedTwentyDayHigh,
        volumeRatio,
        eligible,
        reason: `FAST-FOLLOWER: ${pos.ticker} reclaimed 20d high with ${volumeRatio.toFixed(1)}× volume after stop-hit ${daysSinceExit}d ago`,
      };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FastFollowerSignal | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((v): v is FastFollowerSignal => v !== null);
}
