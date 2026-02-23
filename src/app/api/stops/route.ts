/**
 * DEPENDENCIES
 * Consumed by: StopUpdateQueue (plan + portfolio), nightly via direct import
 * Consumes: stop-manager.ts, market-data.ts, prisma.ts
 * Risk-sensitive: YES — generates and applies stop updates
 * Last modified: 2026-02-23
 * Notes: GET merges R-based AND trailing ATR recommendations into one list,
 *        picking the higher stop per position. Matches nightly Step 3 + 3b.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  updateStopLoss,
  generateStopRecommendations,
  generateTrailingStopRecommendations,
  StopLossError,
} from '@/lib/stop-manager';
import { parseJsonBody } from '@/lib/request-validation';
import prisma from '@/lib/prisma';
import { getBatchPrices } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';

const updateStopSchema = z.object({
  positionId: z.string().min(1, 'positionId is required'),
  newStop: z.number().positive('newStop must be a positive number'),
  reason: z.string().min(1, 'reason is required'),
});

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, updateStopSchema);
    if (!parsed.ok) return parsed.response;
    const { positionId, newStop, reason } = parsed.data;

    await updateStopLoss(positionId, newStop, reason);

    return NextResponse.json({ success: true, message: 'Stop updated successfully' });
  } catch (error) {
    if (error instanceof StopLossError) {
      return apiError(400, 'STOP_MONOTONIC_VIOLATION', error.message);
    }
    console.error('Stop update error:', error);
    return apiError(500, 'STOP_UPDATE_FAILED', 'Failed to update stop', (error as Error).message, true);
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return apiError(400, 'INVALID_REQUEST', 'userId is required');
    }

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const tickers = positions.map((p) => p.stock.ticker);
    const livePrices = tickers.length > 0 ? await getBatchPrices(tickers) : {};
    const priceMap = new Map<string, number>(
      tickers.map((ticker) => [ticker, livePrices[ticker] || 0])
    );

    // Fetch ATR values so LOCK_1R_TRAIL gets the trailing component
    const { getDailyPrices: getDailyPricesFn, calculateATR: calculateATRFn } = await import('@/lib/market-data');
    const atrMap = new Map<string, number>();
    for (const ticker of tickers) {
      try {
        const bars = await getDailyPricesFn(ticker, 'compact');
        if (bars.length >= 15) {
          atrMap.set(ticker, calculateATRFn(bars, 14));
        }
      } catch { /* skip */ }
    }

    // ── Merge R-based + Trailing ATR recommendations ──
    // Mirrors nightly Step 3 + Step 3b: both engines run, highest stop wins per position.
    const rBasedRecs = await generateStopRecommendations(userId, priceMap, atrMap);
    let trailingRecs: Awaited<ReturnType<typeof generateTrailingStopRecommendations>> = [];
    try {
      trailingRecs = await generateTrailingStopRecommendations(userId);
    } catch {
      // Trailing ATR is best-effort — R-based recs still returned if this fails
    }

    // Build a map keyed by positionId, keeping whichever rec has the higher newStop
    const merged = new Map<string, {
      positionId: string;
      ticker: string;
      currentStop: number;
      newStop: number;
      newLevel: string;
      reason: string;
    }>();

    for (const rec of rBasedRecs) {
      merged.set(rec.positionId, {
        positionId: rec.positionId,
        ticker: rec.ticker,
        currentStop: rec.currentStop,
        newStop: rec.newStop,
        newLevel: rec.newLevel,
        reason: rec.reason,
      });
    }

    for (const rec of trailingRecs) {
      const existing = merged.get(rec.positionId);
      if (!existing || rec.trailingStop > existing.newStop) {
        // Trailing ATR wins — use it (only if it's above currentStop, which generateTrailingStopRecommendations guarantees)
        merged.set(rec.positionId, {
          positionId: rec.positionId,
          ticker: rec.ticker,
          currentStop: rec.currentStop,
          newStop: rec.trailingStop,
          newLevel: 'TRAILING_ATR',
          reason: rec.reason,
        });
      }
    }

    return NextResponse.json(Array.from(merged.values()));
  } catch (error) {
    console.error('Stop recommendations error:', error);
    return apiError(500, 'STOP_RECOMMENDATIONS_FAILED', 'Failed to generate stop recommendations', (error as Error).message, true);
  }
}
