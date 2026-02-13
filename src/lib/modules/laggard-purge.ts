// ============================================================
// Module 3: Laggard Purge
// ============================================================
// Flags positions held >10 days that are underwater >2%.
// Suggests trimming stale losers to recycle capital.
// ============================================================

import 'server-only';
import type { LaggardFlag } from '@/types';

interface PositionForLaggard {
  id: string;
  ticker: string;
  entryPrice: number;
  entryDate: Date | string;
  currentPrice: number;
  initialRisk: number;
  shares: number;
  sleeve?: string; // HEDGE positions are excluded
}

/**
 * Check positions for laggard conditions.
 * Criteria:
 *   1. Held > 10 trading days
 *   2. Underwater > 2% from entry
 */
export function detectLaggards(positions: PositionForLaggard[]): LaggardFlag[] {
  const flags: LaggardFlag[] = [];
  const now = new Date();

  for (const pos of positions) {
    // HEDGE positions are long-term holds — exempt from laggard purge
    if (pos.sleeve === 'HEDGE') continue;

    const entryDate = pos.entryDate instanceof Date ? pos.entryDate : new Date(pos.entryDate);
    const daysHeld = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
    const gainPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const rMultiple = pos.initialRisk > 0
      ? (pos.currentPrice - pos.entryPrice) / pos.initialRisk
      : 0;

    if (daysHeld >= 10 && gainPercent < -2) {
      flags.push({
        ticker: pos.ticker,
        positionId: pos.id,
        daysHeld,
        gainPercent,
        rMultiple,
        action: 'TRIM_LAGGARD',
        reason: `Held ${daysHeld} days, down ${Math.abs(gainPercent).toFixed(1)}% (${rMultiple.toFixed(1)}R)`,
      });
    }
  }

  return flags.sort((a, b) => a.gainPercent - b.gainPercent); // worst first
}
