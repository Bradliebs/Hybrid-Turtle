/**
 * DEPENDENCIES
 * Consumed by: Plan page (EarlyBirdWidget)
 * Consumes: early-bird.ts, market-data.ts, prisma
 * Risk-sensitive: YES — alternative entry logic
 * Last modified: 2026-02-19
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getMarketRegime } from '@/lib/market-data';
import { scanEarlyBirds } from '@/lib/modules';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// Cache persists until explicit rescan via ?refresh=true
interface EarlyBirdCache {
  json: { regime: string; signals: unknown[]; message: string; scannedCount: number; cachedAt: string };
}
let _earlyBirdCache: EarlyBirdCache | null = null;

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

  // Return cached result unless refresh requested
  if (!refresh && _earlyBirdCache) {
    return NextResponse.json(_earlyBirdCache.json);
  }

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
      const result = {
        regime,
        signals: [],
        message: `Regime is ${regime} — Early Bird requires BULLISH`,
        scannedCount: 0,
        cachedAt: new Date().toISOString(),
      };
      _earlyBirdCache = { json: result };
      return NextResponse.json(result);
    }

    const signals = await scanEarlyBirds(stocks, regime);

    const result = {
      regime,
      signals,
      message: `${signals.length} Early Bird candidate(s) found`,
      scannedCount: stocks.length,
      cachedAt: new Date().toISOString(),
    };
    _earlyBirdCache = { json: result };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Early Bird] Scan failed:', error);
    return apiError(500, 'EARLY_BIRD_ERROR', 'Early Bird scan failed');
  }
}
