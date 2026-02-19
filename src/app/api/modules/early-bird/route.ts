/**
 * DEPENDENCIES
 * Consumed by: Plan page (EarlyBirdWidget)
 * Consumes: early-bird.ts, market-data.ts, prisma
 * Risk-sensitive: YES — alternative entry logic
 * Last modified: 2026-02-19
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getMarketRegime } from '@/lib/market-data';
import { scanEarlyBirds } from '@/lib/modules';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [regime, stocks] = await Promise.all([
      getMarketRegime(),
      prisma.stock.findMany({
        where: { active: true },
        select: { ticker: true, name: true },
      }),
    ]);

    // Early exit if not bullish — no point scanning
    if (regime !== 'BULLISH') {
      return NextResponse.json({
        regime,
        signals: [],
        message: `Regime is ${regime} — Early Bird requires BULLISH`,
        scannedCount: 0,
      });
    }

    const signals = await scanEarlyBirds(stocks, regime);

    return NextResponse.json({
      regime,
      signals,
      message: `${signals.length} Early Bird candidate(s) found`,
      scannedCount: stocks.length,
    });
  } catch (error) {
    console.error('[Early Bird] Scan failed:', error);
    return apiError(500, 'EARLY_BIRD_ERROR', 'Early Bird scan failed');
  }
}
