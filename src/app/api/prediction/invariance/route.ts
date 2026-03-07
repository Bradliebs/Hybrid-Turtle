/**
 * DEPENDENCIES
 * Consumed by: /causal-audit page
 * Consumes: invariance-scores.ts, irm-trainer.ts, api-response.ts
 * Risk-sensitive: NO — analysis only
 * Last modified: 2026-03-07
 * Notes: GET returns latest invariance scores. POST triggers IRM recomputation.
 */

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getLatestInvarianceScores, getHistoricalInvarianceRuns, computeAndStoreInvarianceScores } from '@/lib/prediction/causal/invariance-scores';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [latest, historicalRuns] = await Promise.all([
      getLatestInvarianceScores(),
      getHistoricalInvarianceRuns(),
    ]);

    if (!latest) {
      return NextResponse.json({
        ok: true,
        data: { hasResult: false, result: null, historicalRuns: [] },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        hasResult: true,
        result: {
          signals: latest.signals,
          computedAt: latest.computedAt,
          sampleSize: latest.sampleSize,
        },
        historicalRuns: historicalRuns.map(r => ({
          runAt: r.computedAt.toISOString(),
          signalScores: r.signalScores,
        })),
      },
    });
  } catch (error) {
    return apiError(500, 'INVARIANCE_FETCH_FAILED', 'Failed to fetch invariance scores', (error as Error).message);
  }
}

export async function POST() {
  try {
    const result = await computeAndStoreInvarianceScores();
    return NextResponse.json({
      ok: true,
      data: {
        signals: result.signals,
        environmentsUsed: result.environmentsUsed,
        totalSamples: result.totalSamples,
        computedAt: result.computedAt,
        dataSource: result.dataSource.source,
        tradesUsed: result.dataSource.tradesUsed,
        scanMatchRate: result.dataSource.scanMatchRate,
        regimeCounts: result.dataSource.regimeCounts,
        lowSampleRegimes: result.dataSource.lowSampleRegimes,
        dataSourceMessage: result.dataSource.message,
      },
    });
  } catch (error) {
    console.error('[IRM] Invariance computation error:', (error as Error).message);
    return apiError(500, 'INVARIANCE_COMPUTE_FAILED', 'Failed to compute invariance scores', (error as Error).message);
  }
}
