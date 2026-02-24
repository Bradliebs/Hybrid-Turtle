/**
 * DEPENDENCIES
 * Consumed by: /risk page (CorrelationPanel widget)
 * Consumes: correlation-matrix.ts
 * Risk-sensitive: NO (read-only, advisory data)
 * Last modified: 2026-02-24
 */

import { NextResponse } from 'next/server';
import { getAllCorrelationFlags } from '@/lib/correlation-matrix';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flags = await getAllCorrelationFlags();

    return NextResponse.json({
      flags,
      count: flags.length,
    });
  } catch (error) {
    console.error('[API] Correlation flags fetch failed:', (error as Error).message);
    return apiError(500, 'CORRELATION_FETCH_FAILED', 'Failed to fetch correlation flags');
  }
}
