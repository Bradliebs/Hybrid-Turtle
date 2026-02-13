// ============================================================
// Module 9: Fast-Follower Re-Entry
// ============================================================
// After stop-hit exit within 10 days, allows quick re-entry if
// stock reclaims 20d high + volume > 2×. Catches shakeout
// recoveries.
// ============================================================

import 'server-only';
import type { FastFollowerSignal } from '@/types';
import { getDailyPrices, calculate20DayHigh } from '../market-data';

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
 */
export async function scanFastFollowers(
  closedPositions: ClosedPositionForFF[]
): Promise<FastFollowerSignal[]> {
  const signals: FastFollowerSignal[] = [];
  const now = new Date();

  const recentStopOuts = closedPositions.filter(p => {
    if (p.exitReason !== 'STOP_HIT') return false;
    const exitDate = p.exitDate instanceof Date ? p.exitDate : new Date(p.exitDate);
    const daysSince = Math.floor((now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSince <= MAX_DAYS_SINCE_EXIT;
  });

  for (const pos of recentStopOuts) {
    try {
      const bars = await getDailyPrices(pos.ticker, 'compact');
      if (bars.length < 20) continue;

      const price = bars[0].close;
      const twentyDayHigh = calculate20DayHigh(bars);
      const volume = bars[0].volume;
      const avgVolume20 = bars.slice(0, 20).reduce((s, b) => s + b.volume, 0) / 20;

      const exitDate = pos.exitDate instanceof Date ? pos.exitDate : new Date(pos.exitDate);
      const daysSinceExit = Math.floor((now.getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24));
      const reclaimedTwentyDayHigh = price >= twentyDayHigh;
      const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 0;
      const volumeOk = volumeRatio >= VOLUME_THRESHOLD;

      const eligible = reclaimedTwentyDayHigh && volumeOk;

      signals.push({
        ticker: pos.ticker,
        exitDate: exitDate.toISOString().split('T')[0],
        daysSinceExit,
        reclaimedTwentyDayHigh,
        volumeRatio,
        eligible,
        reason: eligible
          ? `FAST-FOLLOWER: ${pos.ticker} reclaimed 20d high with ${volumeRatio.toFixed(1)}× volume after stop-hit ${daysSinceExit}d ago`
          : `Not eligible: ${!reclaimedTwentyDayHigh ? 'below 20d high' : ''} ${!volumeOk ? `vol ${volumeRatio.toFixed(1)}× < 2×` : ''}`.trim(),
      });
    } catch {
      // Skip failed tickers
    }
  }

  return signals.filter(s => s.eligible);
}
