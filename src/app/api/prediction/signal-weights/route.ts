/**
 * DEPENDENCIES
 * Consumed by: SignalWeightPanel component, display layer
 * Consumes: signal-weight-meta-model.ts, meta-model-trainer.ts, api-response.ts
 * Risk-sensitive: NO — read-only weight computation
 * Last modified: 2026-03-07
 * Notes: GET returns current weight vector + context. POST triggers retraining.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import { computeSignalWeights, DEFAULT_WEIGHTS } from '@/lib/prediction/signal-weight-meta-model';
import { runTraining, getLatestWeightRecord } from '@/lib/prediction/meta-model-trainer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Try stored weights first (faster, no API calls)
    const stored = await getLatestWeightRecord();

    if (stored) {
      return NextResponse.json({
        ok: true,
        data: {
          weights: stored.weights,
          defaultWeights: DEFAULT_WEIGHTS,
          regime: stored.regime,
          source: stored.source,
          computedAt: stored.computedAt,
          fromCache: true,
        },
      });
    }

    // No stored weights — compute live
    const result = await computeSignalWeights();

    return NextResponse.json({
      ok: true,
      data: {
        weights: result.weights,
        defaultWeights: result.defaultWeights,
        context: result.context,
        source: result.source,
        fromCache: false,
      },
    });
  } catch (error) {
    return apiError(500, 'SIGNAL_WEIGHTS_FAILED', 'Failed to compute signal weights', (error as Error).message);
  }
}

const retrainSchema = z.object({
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, retrainSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await runTraining(parsed.data.force);

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error('[MetaModel] Training error:', (error as Error).message);
    return apiError(500, 'TRAINING_FAILED', 'Failed to run meta-model training', (error as Error).message);
  }
}
