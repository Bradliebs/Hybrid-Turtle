/**
 * DEPENDENCIES
 * Consumed by: Analytics UI
 * Consumes: rule-overlap.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { computeRuleOverlap } from '@/lib/rule-overlap';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const regime = searchParams.get('regime') ?? undefined;
  const minSampleSize = Number(searchParams.get('minSamples')) || 30;
  const coOccurrenceThreshold = Number(searchParams.get('threshold')) || 0.5;

  const pairs = await computeRuleOverlap({
    regime,
    minSampleSize,
    coOccurrenceThreshold,
  });

  return NextResponse.json({
    ok: true,
    count: pairs.length,
    pairs,
  });
}
