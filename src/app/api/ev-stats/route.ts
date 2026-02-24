/**
 * DEPENDENCIES
 * Consumed by: Dashboard / analytics frontend
 * Consumes: ev-tracker.ts, default-user.ts, api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-02-24
 * Notes: Read-only endpoint. Returns expectancy stats sliced by regime, ATR bucket,
 *        cluster, and sleeve. No mutations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getExpectancyStats } from '@/lib/ev-tracker';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const regime = searchParams.get('regime')?.trim() || undefined;
    const sleeve = searchParams.get('sleeve')?.trim() || undefined;
    const atrBucket = searchParams.get('atrBucket')?.trim() || undefined;
    const cluster = searchParams.get('cluster')?.trim() || undefined;

    const stats = await getExpectancyStats({ regime, sleeve, atrBucket, cluster });

    return NextResponse.json({ ok: true, data: stats });
  } catch (error) {
    console.error('EV stats error:', error);
    return apiError(500, 'EV_STATS_FAILED', 'Failed to fetch expectancy stats', (error as Error).message, true);
  }
}
