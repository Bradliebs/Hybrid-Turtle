/**
 * DEPENDENCIES
 * Consumed by: /trade-pulse/[ticker] page
 * Consumes: trade-pulse.ts, multiple prediction APIs for data gathering
 * Risk-sensitive: NO — advisory scoring only
 * Last modified: 2026-03-07
 * Notes: GET returns full TradePulse analysis for a ticker.
 *        Aggregates data from all prediction layers into one response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { computeTradePulse, type TradePulseInput } from '@/lib/prediction/trade-pulse';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    // Build input from query params (pre-fetched by the client page)
    const input: TradePulseInput = {
      ncs: parseFloat(searchParams.get('ncs') ?? '50'),
      fws: parseFloat(searchParams.get('fws') ?? '30'),
      conformalWidth: searchParams.has('conformalWidth') ? parseFloat(searchParams.get('conformalWidth')!) : null,
      fmMaxScore: parseFloat(searchParams.get('fmMax') ?? '0'),
      fmBlockCount: parseInt(searchParams.get('fmBlocks') ?? '0'),
      stressTestProb: searchParams.has('stressProb') ? parseFloat(searchParams.get('stressProb')!) : null,
      gnnScore: searchParams.has('gnn') ? parseFloat(searchParams.get('gnn')!) : null,
      beliefMean: searchParams.has('belief') ? parseFloat(searchParams.get('belief')!) : null,
      kellyVsFixed: searchParams.has('kelly') ? parseFloat(searchParams.get('kelly')!) : null,
      vpinDofi: searchParams.has('dofi') ? parseFloat(searchParams.get('dofi')!) : null,
      sentimentScs: searchParams.has('scs') ? parseFloat(searchParams.get('scs')!) : null,
      invarianceAvg: searchParams.has('invariance') ? parseFloat(searchParams.get('invariance')!) : null,
      dangerScore: parseFloat(searchParams.get('danger') ?? '0'),
    };

    const result = computeTradePulse(input);

    return NextResponse.json({
      ok: true,
      data: {
        ticker,
        ...result,
        computedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return apiError(500, 'TRADE_PULSE_FAILED', 'Failed to compute TradePulse', (error as Error).message);
  }
}
