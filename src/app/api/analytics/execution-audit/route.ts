/**
 * DEPENDENCIES
 * Consumed by: /execution-audit page
 * Consumes: execution-audit.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { generateExecutionAudit } from '@/lib/execution-audit';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sleeve = searchParams.get('sleeve') ?? undefined;

  const result = await generateExecutionAudit({
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    sleeve,
  });

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' },
  });
}
