/**
 * DEPENDENCIES
 * Consumed by: /score-validation page
 * Consumes: score-validation.ts, score-backfill.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { generateScoreValidation } from '@/lib/score-validation';
import { backfillScoresOnOutcomes } from '@/lib/score-backfill';

/**
 * GET /api/analytics/score-validation
 * Generate score validation report.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sleeve = searchParams.get('sleeve') ?? undefined;

  const result = await generateScoreValidation({
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    sleeve,
  });

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=60' },
  });
}

/**
 * POST /api/analytics/score-validation
 * Trigger score backfill from ScoreBreakdown → CandidateOutcome.
 */
export async function POST() {
  const result = await backfillScoresOnOutcomes();
  return NextResponse.json({ ok: true, ...result });
}
