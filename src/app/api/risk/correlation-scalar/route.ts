/**
 * DEPENDENCIES
 * Consumed by: BuyConfirmationModal.tsx (client fetch)
 * Consumes: correlation-matrix.ts (checkCorrelationWarnings)
 * Risk-sensitive: YES (provides scalar that reduces position size)
 * Last modified: 2026-03-01
 * Notes: Returns correlation scalar + reason for a candidate ticker vs open positions.
 *        Called before buy execution to determine if size reduction is needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCorrelationWarnings } from '@/lib/correlation-matrix';
import { getCorrelationScalar } from '@/lib/correlation-scalar';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  ticker: z.string().trim().min(1),
  openTickers: z.array(z.string().trim().min(1)),
});

/**
 * POST /api/risk/correlation-scalar
 *
 * Given a candidate ticker and list of open position tickers,
 * returns the correlation-based position size scalar.
 *
 * Request: { ticker: string, openTickers: string[] }
 * Response: { scalar: number, reason: string | null, correlatedTicker: string | null, maxCorrelation: number | null }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, openTickers } = requestSchema.parse(body);

    // Use existing correlation matrix data (cached in DB from nightly run)
    const warnings = await checkCorrelationWarnings(ticker, openTickers);
    const result = getCorrelationScalar(warnings);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(400, 'INVALID_REQUEST', error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '));
    }
    console.error('[API] Correlation scalar failed:', (error as Error).message);
    return apiError(500, 'CORRELATION_SCALAR_FAILED', 'Failed to compute correlation scalar');
  }
}
