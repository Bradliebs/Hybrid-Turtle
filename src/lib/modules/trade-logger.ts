// ============================================================
// Module 15: Trade Logger / Slippage Tracking
// ============================================================
// Logs every BUY/SELL with expected vs actual fill price,
// slippage %. Provides execution quality audit trail.
// ============================================================

import 'server-only';
import prisma from '../prisma';
import type { TradeLogEntry } from '@/types';

/** Prisma TradeLog record shape used within this module */
interface TradeLogRecord {
  id: string;
  ticker: string;
  action: string;
  expectedPrice: number;
  actualPrice: number | null;
  slippagePercent: number | null;
  shares: number;
  reason: string | null;
  createdAt: Date;
}

// Use prisma's tradeLog model — cast once to access dynamic model
const db = prisma as unknown as typeof prisma & {
  tradeLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<TradeLogRecord>;
    findMany: (args: Record<string, unknown>) => Promise<TradeLogRecord[]>;
  };
};

/**
 * Log a trade execution.
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

  await db.tradeLog.create({
    data: {
      positionId: data.positionId,
      userId: data.userId,
      ticker: data.ticker,
      action: data.action,
      expectedPrice: data.expectedPrice,
      actualPrice: data.actualPrice || null,
      slippagePercent,
      shares: data.shares,
      reason: data.reason || null,
      rMultipleAtExit: data.rMultipleAtExit || null,
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
  const logs = await db.tradeLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((l) => ({
    id: l.id,
    ticker: l.ticker,
    action: l.action as 'BUY' | 'SELL' | 'TRIM',
    expectedPrice: l.expectedPrice,
    actualPrice: l.actualPrice,
    slippagePercent: l.slippagePercent,
    shares: l.shares,
    reason: l.reason || '',
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
  const logs = await db.tradeLog.findMany({
    where: {
      userId,
      slippagePercent: { not: null },
    },
  });

  if (logs.length === 0) {
    return { totalTrades: 0, avgSlippagePct: 0, worstSlippagePct: 0, totalSlippageDollars: 0 };
  }

  const slippages = logs.map((l) => l.slippagePercent as number);
  const totalSlippageDollars = logs.reduce((sum: number, l) => {
    if (l.actualPrice && l.expectedPrice) {
      return sum + Math.abs(l.actualPrice - l.expectedPrice) * l.shares;
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
