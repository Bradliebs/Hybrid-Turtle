/**
 * DEPENDENCIES
 * Consumed by: BeliefStatePanel component
 * Consumes: belief-state.ts, belief-informed-weights.ts, bayesian-updater.ts, api-response.ts
 * Risk-sensitive: NO — read-only belief queries + manual update trigger
 * Last modified: 2026-03-07
 * Notes: GET returns 28 belief states. POST triggers processing of recent closures.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getAllBeliefs } from '@/lib/prediction/bayesian/belief-state';
import { getBeliefWeightAdjustments } from '@/lib/prediction/bayesian/belief-informed-weights';
import { processRecentClosures } from '@/lib/prediction/bayesian/bayesian-updater';
import type { RegimeId } from '@/lib/prediction/bayesian/belief-state';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const regime = searchParams.get('regime') as RegimeId | null;

  try {
    const beliefs = await getAllBeliefs();

    let adjustments = null;
    if (regime) {
      adjustments = await getBeliefWeightAdjustments(regime);
    }

    return NextResponse.json({
      ok: true,
      data: {
        beliefs,
        adjustments: adjustments ? {
          regime: adjustments.regime,
          multipliers: adjustments.adjustments,
        } : null,
      },
    });
  } catch (error) {
    return apiError(500, 'BELIEFS_FAILED', 'Failed to fetch belief states', (error as Error).message);
  }
}

export async function POST() {
  try {
    const result = await processRecentClosures();
    return NextResponse.json({
      ok: true,
      data: {
        processed: result.processed,
        results: result.results,
      },
    });
  } catch (error) {
    console.error('[Bayesian] Update error:', (error as Error).message);
    return apiError(500, 'BELIEFS_UPDATE_FAILED', 'Failed to process trade outcomes', (error as Error).message);
  }
}
