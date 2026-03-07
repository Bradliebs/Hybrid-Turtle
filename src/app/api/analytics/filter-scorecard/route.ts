/**
 * DEPENDENCIES
 * Consumed by: /filter-scorecard page
 * Consumes: filter-scorecard.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { generateFilterScorecard } from '@/lib/filter-scorecard';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sleeve = searchParams.get('sleeve') ?? undefined;
  const status = searchParams.get('status') ?? undefined;

  const result = await generateFilterScorecard({
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    sleeve,
    status,
  });

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=60' },
  });
}
