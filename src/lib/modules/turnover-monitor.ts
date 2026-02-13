// ============================================================
// Module 16: Turnover Monitor
// ============================================================
// Tracks trades/30 days, avg holding period, oldest position age.
// ============================================================

import 'server-only';
import type { TurnoverMetrics } from '@/types';

interface PositionForTurnover {
  entryDate: Date | string;
  exitDate?: Date | string | null;
  status: string;
}

/**
 * Calculate turnover metrics for a user's portfolio.
 */
export function calculateTurnover(
  positions: PositionForTurnover[],
  tradeCountLast30Days: number
): TurnoverMetrics {
  const now = new Date();

  // Open positions for holding period / oldest
  const openPositions = positions.filter(p => p.status === 'OPEN');

  const holdingPeriods = openPositions.map(p => {
    const entry = p.entryDate instanceof Date ? p.entryDate : new Date(p.entryDate);
    return Math.floor((now.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
  });

  const avgHoldingPeriod = holdingPeriods.length > 0
    ? holdingPeriods.reduce((s, d) => s + d, 0) / holdingPeriods.length
    : 0;

  const oldestPositionAge = holdingPeriods.length > 0
    ? Math.max(...holdingPeriods)
    : 0;

  // Closed positions in last 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const closedLast30 = positions.filter(p => {
    if (p.status !== 'CLOSED' || !p.exitDate) return false;
    const exitDate = p.exitDate instanceof Date ? p.exitDate : new Date(p.exitDate);
    return exitDate >= thirtyDaysAgo;
  }).length;

  return {
    tradesLast30Days: tradeCountLast30Days,
    avgHoldingPeriod: Math.round(avgHoldingPeriod),
    oldestPositionAge,
    closedPositionsLast30: closedLast30,
  };
}
