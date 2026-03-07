/**
 * DEPENDENCIES
 * Consumed by: KellySizePanel component
 * Consumes: portfolio-kelly.ts, api-response.ts
 * Risk-sensitive: NO — advisory sizing suggestion only
 * Last modified: 2026-03-07
 * Notes: GET returns Kelly-adjusted position size suggestion.
 *        Output is a SUGGESTION — position-sizer.ts hard caps always prevail.
 *        ⛔ Does NOT modify position-sizer.ts or risk-gates.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { computePortfolioKelly } from '@/lib/prediction/kelly/portfolio-kelly';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    const ncs = parseFloat(searchParams.get('ncs') ?? '50');
    const baseWinRate = parseFloat(searchParams.get('winRate') ?? '0.45');
    const avgWinR = parseFloat(searchParams.get('avgWinR') ?? '2.0');
    const avgLossR = parseFloat(searchParams.get('avgLossR') ?? '1.0');
    const maxRiskPerTrade = parseFloat(searchParams.get('maxRisk') ?? '2.0');
    const conformalWidth = parseFloat(searchParams.get('conformalWidth') ?? '10');
    const beliefMean = parseFloat(searchParams.get('beliefMean') ?? '0.5');
    const gnnConfidence = parseFloat(searchParams.get('gnnConf') ?? '0.5');
    const avgCorrelation = parseFloat(searchParams.get('avgCorr') ?? '0.3');

    const result = computePortfolioKelly({
      ncs,
      baseWinRate,
      avgWinR,
      avgLossR,
      uncertainty: {
        conformalIntervalWidth: conformalWidth,
        beliefMean,
        gnnConfidence,
      },
      avgCorrelationWithPortfolio: avgCorrelation,
      maxRiskPerTrade,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return apiError(500, 'KELLY_FAILED', 'Failed to compute Kelly size', (error as Error).message);
  }
}
