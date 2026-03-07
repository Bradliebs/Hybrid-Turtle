/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/execution-drag/route.ts
 * Consumes: prisma.ts, @/types
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 * Notes: Computes model-vs-actual execution drag from TradeLog data.
 *        Uses existing TradeLog fields: entryPrice, actualFill, slippagePct,
 *        initialStop, initialR, finalRMultiple, plannedEntry, fillTime.
 */
import type { ExecutionDragRecord, ExecutionDragSummary } from '@/types';
import prisma from './prisma';

/**
 * Compute execution drag for a single trade log entry.
 */
function computeSingleDrag(trade: {
  id: string;
  ticker: string;
  tradeDate: Date;
  entryPrice: number | null;
  actualFill: number | null;
  slippagePct: number | null;
  initialStop: number | null;
  initialR: number | null;
  finalRMultiple: number | null;
  plannedEntry: number | null;
  fillTime: Date | null;
}): ExecutionDragRecord | null {
  const modelEntry = trade.plannedEntry ?? trade.entryPrice;
  if (modelEntry == null) return null;

  const entrySlippage = trade.actualFill != null && modelEntry > 0
    ? ((trade.actualFill - modelEntry) / modelEntry) * 100
    : trade.slippagePct;

  // Days between trade date and actual fill
  const daysToFill = trade.fillTime
    ? Math.max(0, Math.round((trade.fillTime.getTime() - trade.tradeDate.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const rDrag = trade.finalRMultiple != null && trade.initialR != null
    ? trade.finalRMultiple - trade.initialR
    : null;

  return {
    tradeLogId: trade.id,
    ticker: trade.ticker,
    tradeDate: trade.tradeDate.toISOString(),
    modelEntry,
    actualEntry: trade.actualFill,
    entrySlippagePct: entrySlippage ?? null,
    modelStop: trade.initialStop ?? 0,
    actualStop: null, // would need stop-at-close data to fill this
    modelR: trade.initialR,
    actualR: trade.finalRMultiple,
    rDrag,
    daysToFill,
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute execution drag records and summary for all executed trades.
 */
export async function computeExecutionDrag(opts?: {
  userId?: string;
  from?: Date;
  to?: Date;
}): Promise<{ records: ExecutionDragRecord[]; summary: ExecutionDragSummary }> {
  const where: Record<string, unknown> = {
    decision: { in: ['EXECUTED', 'BUY'] },
  };
  if (opts?.userId) where.userId = opts.userId;
  if (opts?.from || opts?.to) {
    where.tradeDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const trades = await prisma.tradeLog.findMany({
    where,
    select: {
      id: true,
      ticker: true,
      tradeDate: true,
      entryPrice: true,
      actualFill: true,
      slippagePct: true,
      initialStop: true,
      initialR: true,
      finalRMultiple: true,
      plannedEntry: true,
      fillTime: true,
      gainLossGbp: true,
    },
    orderBy: { tradeDate: 'desc' },
  });

  const records: ExecutionDragRecord[] = [];
  for (const trade of trades) {
    const drag = computeSingleDrag(trade);
    if (drag) records.push(drag);
  }

  // Aggregate
  const slippages = records.map((r) => r.entrySlippagePct).filter((v): v is number => v != null);
  const rDrags = records.map((r) => r.rDrag).filter((v): v is number => v != null);
  const daysToFills = records.map((r) => r.daysToFill).filter((v): v is number => v != null);

  // Estimate total slippage cost: sum of (actualFill - modelEntry) * shares
  // Simplified: use gainLossGbp × slippage contribution
  let totalSlippageCostGbp = 0;
  for (const trade of trades) {
    if (trade.actualFill != null && trade.entryPrice != null && trade.slippagePct != null) {
      const slipCost = Math.abs((trade.actualFill - (trade.plannedEntry ?? trade.entryPrice))) * 1; // per share approximation
      totalSlippageCostGbp += slipCost;
    }
  }

  const summary: ExecutionDragSummary = {
    totalTrades: records.length,
    withFills: slippages.length,
    avgEntrySlippagePct: slippages.length > 0 ? slippages.reduce((a, b) => a + b, 0) / slippages.length : 0,
    medianEntrySlippagePct: median(slippages),
    p90EntrySlippagePct: percentile(slippages, 90),
    avgRDrag: rDrags.length > 0 ? rDrags.reduce((a, b) => a + b, 0) / rDrags.length : 0,
    medianRDrag: median(rDrags),
    avgDaysToFill: daysToFills.length > 0 ? daysToFills.reduce((a, b) => a + b, 0) / daysToFills.length : 0,
    totalSlippageCostGbp: Math.round(totalSlippageCostGbp * 100) / 100,
  };

  return { records, summary };
}
