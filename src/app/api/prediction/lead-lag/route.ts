/**
 * DEPENDENCIES
 * Consumed by: LeadLagPanel component
 * Consumes: lead-lag-graph.ts, api-response.ts
 * Risk-sensitive: NO — read-only graph queries + on-demand signal computation
 * Last modified: 2026-03-07
 * Notes: GET returns upstream signals for a ticker or full graph.
 *        POST triggers weekly recomputation (manual override).
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import {
  computeLeadLagSignals,
  getAllEdges,
  recomputeLeadLagGraph,
} from '@/lib/prediction/lead-lag-graph';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  try {
    if (ticker) {
      // Return upstream signals for a specific ticker
      const signals = await computeLeadLagSignals(ticker);
      return NextResponse.json({
        ok: true,
        data: {
          ticker: signals.ticker,
          ncsAdjustment: signals.ncsAdjustment,
          upstreamSignals: signals.upstreamSignals,
          hasEdges: signals.upstreamSignals.length > 0,
        },
      });
    }

    // Return full graph summary
    const edges = await getAllEdges();

    // Group by follower
    const byFollower = new Map<string, number>();
    for (const edge of edges) {
      byFollower.set(edge.follower, (byFollower.get(edge.follower) ?? 0) + 1);
    }

    return NextResponse.json({
      ok: true,
      data: {
        totalEdges: edges.length,
        uniqueFollowers: byFollower.size,
        edges: edges.slice(0, 100), // cap at 100 for response size
      },
    });
  } catch (error) {
    return apiError(500, 'LEAD_LAG_FAILED', 'Failed to query lead-lag graph', (error as Error).message);
  }
}

export async function POST() {
  try {
    const result = await recomputeLeadLagGraph(50);
    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error('[LeadLag] Recomputation error:', (error as Error).message);
    return apiError(500, 'LEAD_LAG_COMPUTE_FAILED', 'Failed to recompute lead-lag graph', (error as Error).message);
  }
}
