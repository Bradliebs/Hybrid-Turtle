/**
 * DEPENDENCIES
 * Consumed by: Analytics UI
 * Consumes: execution-drag.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { computeExecutionDrag } from '@/lib/execution-drag';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') ?? undefined;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const result = await computeExecutionDrag({
    userId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    records: result.records,
  });
}
