/**
 * DEPENDENCIES
 * Consumed by: VPINBadge component
 * Consumes: vpin-calculator.ts, market-data.ts, prisma.ts, api-response.ts
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: GET returns VPIN/DOFI for a ticker. Uses cached data if fresh (< 24h).
 *        ⛔ Does NOT modify sacred files.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { computeVPIN } from '@/lib/signals/vpin-calculator';
import { getDailyPrices } from '@/lib/market-data';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    // Check cache first
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const cached = await prisma.vPINHistory.findFirst({
      where: { ticker, computedAt: { gte: cutoff } },
      orderBy: { computedAt: 'desc' },
    });

    if (cached) {
      return NextResponse.json({
        ok: true,
        data: {
          ticker: cached.ticker,
          vpin: cached.vpin,
          dofi: cached.dofi,
          signal: cached.signal,
          ncsAdjustment: cached.ncsAdjustment,
          barsUsed: cached.barsUsed,
          computedAt: cached.computedAt,
          fromCache: true,
        },
      });
    }

    // Compute fresh
    const bars = await getDailyPrices(ticker, 'compact');
    if (!bars || bars.length < 5) {
      return NextResponse.json({
        ok: true,
        data: { ticker, vpin: 0, dofi: 0, signal: 'NEUTRAL', ncsAdjustment: 0, barsUsed: 0, hasResult: false },
      });
    }

    const result = computeVPIN(ticker, bars.map(b => ({
      date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    })));

    // Cache result
    await prisma.vPINHistory.create({
      data: {
        ticker,
        vpin: result.vpin,
        dofi: result.dofi,
        signal: result.signal,
        ncsAdjustment: result.ncsAdjustment,
        barsUsed: result.barsUsed,
      },
    });

    return NextResponse.json({
      ok: true,
      data: { ...result, fromCache: false, hasResult: true },
    });
  } catch (error) {
    return apiError(500, 'VPIN_FAILED', 'Failed to compute VPIN', (error as Error).message);
  }
}
