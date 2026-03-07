/**
 * DEPENDENCIES
 * Consumed by: GraphScorePanel component, TodayPanel
 * Consumes: gnn-inference.ts, api-response.ts
 * Risk-sensitive: NO — read-only scoring
 * Last modified: 2026-03-07
 * Notes: GET returns GNN score for a ticker. POST triggers retraining.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getGNNScore, type GNNScoreResult } from '@/lib/prediction/gnn/gnn-inference';
import { runGNNTraining } from '@/lib/prediction/gnn/gnn-trainer';
import type { NodeFeatures } from '@/lib/prediction/gnn/graph-builder';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    // Build a minimal feature map for this ticker from query params
    const featureMap = new Map<string, NodeFeatures>();
    const ncs = parseFloat(searchParams.get('ncs') ?? '50');
    const volumeRatio = parseFloat(searchParams.get('volumeRatio') ?? '1');
    const atrPct = parseFloat(searchParams.get('atrPct') ?? '3');
    const regimeScore = parseFloat(searchParams.get('regimeScore') ?? '50');
    const fmMax = parseFloat(searchParams.get('fmMax') ?? '0');

    featureMap.set(ticker, {
      ncs,
      priceReturn1d: 0,
      priceReturn5d: 0,
      volumeRatio,
      atrPercentile: Math.min(atrPct / 8, 1),
      regimeScore,
      failureModeMax: fmMax,
    });

    const result = await getGNNScore(ticker, featureMap);

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    return apiError(500, 'GNN_SCORE_FAILED', 'Failed to compute GNN score', (error as Error).message);
  }
}

export async function POST() {
  try {
    const result = await runGNNTraining(true);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    console.error('[GNN] Training trigger error:', (error as Error).message);
    return apiError(500, 'GNN_TRAINING_FAILED', 'Failed to train GNN', (error as Error).message);
  }
}
