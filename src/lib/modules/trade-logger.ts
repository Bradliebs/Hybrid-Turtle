// ============================================================
// Module 15: Trade Logger / Slippage Tracking
// ============================================================
// Logs every BUY/SELL with expected vs actual fill price,
// slippage %. Provides execution quality audit trail.
// ============================================================

import 'server-only';
import prisma from '../prisma';
import type { TradeLogEntry } from '@/types';

/**
 * Log a trade execution.
 * Uses the proper TradeLog schema fields from Prisma.
 */
export async function logTrade(data: {
  positionId: string;
  userId: string;
  ticker: string;
  action: 'BUY' | 'SELL' | 'TRIM';
  expectedPrice: number;
  actualPrice?: number;
  shares: number;
  reason?: string;
  rMultipleAtExit?: number;
}): Promise<void> {
  const slippagePercent = data.actualPrice && data.expectedPrice > 0
    ? ((data.actualPrice - data.expectedPrice) / data.expectedPrice) * 100
    : null;

  await prisma.tradeLog.create({
    data: {
      positionId: data.positionId,
      userId: data.userId,
      ticker: data.ticker,
      tradeDate: new Date(),
      tradeType: data.action === 'BUY' ? 'ENTRY' : data.action === 'SELL' ? 'EXIT' : 'TRIM',
      entryPrice: data.expectedPrice,
      plannedEntry: data.expectedPrice,
      actualFill: data.actualPrice ?? null,
      slippagePct: slippagePercent,
      shares: data.shares,
      decision: 'TAKEN',
      decisionReason: data.reason ?? null,
      finalRMultiple: data.rMultipleAtExit ?? null,
    },
  });
}

/**
 * Get trade log history for a user.
 */
export async function getTradeLog(
  userId: string,
  limit: number = 50
): Promise<TradeLogEntry[]> {
  const logs = await prisma.tradeLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((l) => ({
    id: l.id,
    ticker: l.ticker,
    action: (l.tradeType === 'ENTRY' ? 'BUY' : l.tradeType === 'EXIT' ? 'SELL' : 'TRIM') as 'BUY' | 'SELL' | 'TRIM',
    expectedPrice: l.entryPrice ?? l.plannedEntry ?? 0,
    actualPrice: l.actualFill,
    slippagePercent: l.slippagePct,
    shares: l.shares ?? 0,
    reason: l.decisionReason || '',
    createdAt: l.createdAt.toISOString(),
  }));
}

/**
 * Get slippage summary statistics.
 */
export async function getSlippageSummary(userId: string): Promise<{
  totalTrades: number;
  avgSlippagePct: number;
  worstSlippagePct: number;
  totalSlippageDollars: number;
}> {
  const logs = await prisma.tradeLog.findMany({
    where: {
      userId,
      slippagePct: { not: null },
    },
  });

  if (logs.length === 0) {
    return { totalTrades: 0, avgSlippagePct: 0, worstSlippagePct: 0, totalSlippageDollars: 0 };
  }

  const slippages = logs.map((l) => l.slippagePct as number);
  const totalSlippageDollars = logs.reduce((sum: number, l) => {
    if (l.actualFill && l.plannedEntry) {
      return sum + Math.abs(l.actualFill - l.plannedEntry) * (l.shares ?? 0);
    }
    return sum;
  }, 0);

  return {
    totalTrades: logs.length,
    avgSlippagePct: slippages.reduce((s: number, v: number) => s + v, 0) / slippages.length,
    worstSlippagePct: Math.max(...slippages.map(Math.abs)),
    totalSlippageDollars,
  };
}
