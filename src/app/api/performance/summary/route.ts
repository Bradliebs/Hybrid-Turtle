export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';

/**
 * DEPENDENCIES
 * Consumed by: /performance page
 * Consumes: prisma.ts, api-response.ts
 * Risk-sensitive: NO — read-only, no DB writes
 * Last modified: 2026-03-01
 * Notes: Degrades gracefully with nulls when data is insufficient
 */

// GET /api/performance/summary — account performance overview
export async function GET() {
  try {
    // Equity curve + starting/current equity
    const snapshots = await prisma.equitySnapshot.findMany({
      orderBy: { capturedAt: 'asc' },
      select: { equity: true, capturedAt: true },
    });

    const startingEquity = snapshots.length > 0 ? snapshots[0].equity : null;
    const currentEquity = snapshots.length > 0 ? snapshots[snapshots.length - 1].equity : null;
    const totalGainLoss =
      startingEquity != null && currentEquity != null
        ? currentEquity - startingEquity
        : null;
    const totalGainLossPct =
      startingEquity != null && startingEquity > 0 && totalGainLoss != null
        ? (totalGainLoss / startingEquity) * 100
        : null;

    // Weeks running — from first snapshot to now
    const weeksRunning =
      snapshots.length > 0
        ? Math.max(
            1,
            Math.floor(
              (Date.now() - new Date(snapshots[0].capturedAt).getTime()) /
                (7 * 24 * 60 * 60 * 1000)
            )
          )
        : 0;

    const equityCurve = snapshots.map((s) => ({
      date: s.capturedAt.toISOString().slice(0, 10),
      value: s.equity,
    }));

    // Closed trade stats from TradeLog
    const closedTrades = await prisma.tradeLog.findMany({
      where: {
        tradeType: 'CLOSE',
        gainLossGbp: { not: null },
      },
      select: {
        ticker: true,
        gainLossGbp: true,
        tradeDate: true,
        daysHeld: true,
      },
      orderBy: { tradeDate: 'desc' },
    });

    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter((t) => (t.gainLossGbp ?? 0) > 0).length;
    const losingTrades = closedTrades.filter((t) => (t.gainLossGbp ?? 0) <= 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : null;

    let bestTrade: { ticker: string; gainLoss: number } | null = null;
    let worstTrade: { ticker: string; gainLoss: number } | null = null;

    if (closedTrades.length > 0) {
      const sorted = [...closedTrades].sort(
        (a, b) => (b.gainLossGbp ?? 0) - (a.gainLossGbp ?? 0)
      );
      bestTrade = {
        ticker: sorted[0].ticker,
        gainLoss: sorted[0].gainLossGbp ?? 0,
      };
      worstTrade = {
        ticker: sorted[sorted.length - 1].ticker,
        gainLoss: sorted[sorted.length - 1].gainLossGbp ?? 0,
      };
    }

    // Open positions with unrealised gain/loss
    const openPositions = await prisma.position.findMany({
      where: { status: 'OPEN' },
      include: { stock: { select: { ticker: true } } },
    });

    const openPositionData = openPositions.map((pos) => ({
      ticker: pos.stock.ticker,
      unrealisedGainLoss: pos.exitPrice != null
        ? (pos.exitPrice - pos.entryPrice) * pos.shares
        : null,
    }));

    // Closed trade list for the page
    const tradeList = closedTrades.map((t) => ({
      ticker: t.ticker,
      tradeDate: t.tradeDate.toISOString().slice(0, 10),
      daysHeld: t.daysHeld,
      gainLoss: t.gainLossGbp,
    }));

    return NextResponse.json({
      ok: true,
      weeksRunning,
      startingEquity,
      currentEquity,
      totalGainLoss,
      totalGainLossPct,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      bestTrade,
      worstTrade,
      openPositions: openPositionData,
      equityCurve,
      tradeList,
    });
  } catch (err) {
    console.error('GET /api/performance/summary error:', err);
    return apiError(500, 'PERFORMANCE_ERROR', 'Failed to fetch performance data');
  }
}
